import type { IStorageBackend, RemoteFile } from './types.js';

interface GHContentResponse {
  sha: string;
  size: number;
  content: string; // base64, wrapped at 60 chars
}

interface GHTreeNode {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

interface GHTreeResponse {
  tree: GHTreeNode[];
  truncated?: boolean;
}

export class GitHubBackend implements IStorageBackend {
  readonly name: string;
  private readonly apiBase: string;
  private readonly headers: Record<string, string>;

  constructor(
    private readonly token: string,
    private readonly owner: string,
    private readonly repo: string,
  ) {
    this.name = `GitHub (${owner}/${repo})`;
    this.apiBase = `https://api.github.com/repos/${owner}/${repo}`;
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cortex-cli',
    };
  }

  private url(path: string): string {
    return `${this.apiBase}/contents/${path}`;
  }

  private async getSha(path: string): Promise<string | null> {
    const res = await fetch(this.url(path), { headers: this.headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API error ${res.status} on GET ${path}`);
    const data = (await res.json()) as GHContentResponse;
    return data.sha;
  }

  async has(path: string): Promise<boolean> {
    const res = await fetch(this.url(path), { headers: this.headers });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`GitHub API error ${res.status} on has(${path})`);
    return true;
  }

  async read(path: string): Promise<Buffer> {
    const res = await fetch(this.url(path), { headers: this.headers });
    if (!res.ok) throw new Error(`GitHub read failed (${res.status}): ${path}`);
    const data = (await res.json()) as GHContentResponse;
    // GitHub wraps base64 at 60 chars — strip newlines before decoding
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64');
  }

  async write(path: string, content: Buffer): Promise<void> {
    const sha = await this.getSha(path);
    const body: Record<string, unknown> = {
      message: `cortex: update ${path}`,
      content: content.toString('base64'),
    };
    if (sha) body.sha = sha;

    const res = await fetch(this.url(path), {
      method: 'PUT',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub write failed (${res.status}): ${text}`);
    }
  }

  async remove(path: string): Promise<void> {
    const sha = await this.getSha(path);
    if (!sha) return; // idempotent — already gone

    const res = await fetch(this.url(path), {
      method: 'DELETE',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `cortex: remove ${path}`, sha }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub delete failed (${res.status}): ${text}`);
    }
  }

  async list(): Promise<RemoteFile[]> {
    const res = await fetch(`${this.apiBase}/git/trees/HEAD?recursive=1`, {
      headers: this.headers,
    });
    if (res.status === 404 || res.status === 409) return []; // empty repo / no HEAD
    if (!res.ok) throw new Error(`GitHub list failed (${res.status})`);
    const data = (await res.json()) as GHTreeResponse;
    return data.tree
      .filter((n) => n.type === 'blob')
      .map((n) => ({ path: n.path, size: n.size ?? 0 }));
  }
}

/** Fetch the authenticated user's GitHub login. */
export async function fetchGitHubUser(token: string): Promise<string> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cortex-cli',
    },
  });
  if (!res.ok) throw new Error(`GitHub token validation failed (${res.status}). Check your PAT.`);
  const data = (await res.json()) as { login: string };
  return data.login;
}

/** Create a private repo for the authenticated user. No-ops if it already exists. */
export async function ensureGitHubRepo(token: string, repo: string): Promise<void> {
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cortex-cli',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: repo,
      private: true,
      description: 'cortex encrypted backup — do not modify manually',
      auto_init: true, // creates initial commit so HEAD exists
    }),
  });
  // 422 = repo already exists — not an error
  if (!res.ok && res.status !== 422) {
    const text = await res.text();
    throw new Error(`Failed to create GitHub repo (${res.status}): ${text}`);
  }
}
