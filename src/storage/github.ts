import type { IStorageBackend, RemoteFile } from './types.js';

interface GHContentResponse {
  sha: string;
  size: number;
  content?: string; // base64, wrapped at 60 chars — omitted by GitHub for files >1MB
}

interface GHBlobResponse {
  content: string; // base64, wrapped at 60 chars
  encoding: string;
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

export interface FileWrite {
  path: string;
  content: Buffer;
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
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `${this.apiBase}/contents/${encoded}`;
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

  /**
   * Reads via the Blobs API (by sha), not the Contents API's content field —
   * GitHub omits `content` in the Contents API response for files over 1MB,
   * silently truncating pull/status for any session that size. The Blobs API
   * has no such limit.
   */
  async read(path: string): Promise<Buffer> {
    const sha = await this.getSha(path);
    if (!sha) throw new Error(`GitHub read failed (404): ${path}`);
    const res = await fetch(`${this.apiBase}/git/blobs/${sha}`, { headers: this.headers });
    if (!res.ok) throw new Error(`GitHub read failed (${res.status}): ${path}`);
    const data = (await res.json()) as GHBlobResponse;
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64');
  }

  async write(path: string, content: Buffer): Promise<void> {
    await this.writeMany([{ path, content }]);
  }

  async remove(path: string): Promise<void> {
    await this.removeMany([path]);
  }

  /**
   * Uploads any number of files as ONE commit via the Git Data API
   * (blob per file, one tree, one commit, one ref update) — instead of one
   * Contents-API PUT (and one commit) per file. Fixes both the 1MB-per-file
   * limit and the commit spam a large sync used to produce.
   */
  async writeMany(files: FileWrite[]): Promise<void> {
    if (files.length === 0) return;
    const branch = await this.getDefaultBranch();
    const parentSha = await this.getRefSha(branch);
    const baseTreeSha = await this.getCommitTreeSha(parentSha);

    const entries = [];
    for (const f of files) {
      const blobSha = await this.createBlob(f.content);
      entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blobSha });
    }
    await this.commitTreeEntries(branch, parentSha, baseTreeSha, entries, `cortex: update ${files.length} file(s)`);
  }

  /** Deletes any number of paths as one commit (tree entries with sha: null). */
  async removeMany(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const branch = await this.getDefaultBranch();
    const parentSha = await this.getRefSha(branch);
    const baseTreeSha = await this.getCommitTreeSha(parentSha);

    const entries = paths.map((path) => ({ path, mode: '100644', type: 'blob', sha: null }));
    await this.commitTreeEntries(branch, parentSha, baseTreeSha, entries, `cortex: remove ${paths.length} file(s)`);
  }

  private async getDefaultBranch(): Promise<string> {
    const res = await fetch(this.apiBase, { headers: this.headers });
    if (!res.ok) throw new Error(`GitHub API error ${res.status} fetching repo info`);
    const data = (await res.json()) as { default_branch: string };
    return data.default_branch;
  }

  private async getRefSha(branch: string): Promise<string> {
    const res = await fetch(`${this.apiBase}/git/refs/heads/${branch}`, { headers: this.headers });
    if (!res.ok) throw new Error(`GitHub API error ${res.status} fetching ref heads/${branch}`);
    const data = (await res.json()) as { object: { sha: string } };
    return data.object.sha;
  }

  private async getCommitTreeSha(commitSha: string): Promise<string> {
    const res = await fetch(`${this.apiBase}/git/commits/${commitSha}`, { headers: this.headers });
    if (!res.ok) throw new Error(`GitHub API error ${res.status} fetching commit ${commitSha}`);
    const data = (await res.json()) as { tree: { sha: string } };
    return data.tree.sha;
  }

  private async createBlob(content: Buffer): Promise<string> {
    const res = await fetch(`${this.apiBase}/git/blobs`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
    });
    if (!res.ok) throw new Error(`GitHub API error ${res.status} creating blob`);
    const data = (await res.json()) as { sha: string };
    return data.sha;
  }

  private async commitTreeEntries(
    branch: string,
    parentSha: string,
    baseTreeSha: string,
    entries: Array<{ path: string; mode: string; type: string; sha: string | null }>,
    message: string,
  ): Promise<void> {
    const treeRes = await fetch(`${this.apiBase}/git/trees`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
    });
    if (!treeRes.ok) throw new Error(`GitHub API error ${treeRes.status} creating tree`);
    const { sha: newTreeSha } = (await treeRes.json()) as { sha: string };

    const commitRes = await fetch(`${this.apiBase}/git/commits`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, tree: newTreeSha, parents: [parentSha] }),
    });
    if (!commitRes.ok) throw new Error(`GitHub API error ${commitRes.status} creating commit`);
    const { sha: newCommitSha } = (await commitRes.json()) as { sha: string };

    const refRes = await fetch(`${this.apiBase}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: newCommitSha }),
    });
    if (!refRes.ok) throw new Error(`GitHub API error ${refRes.status} updating ref heads/${branch}`);
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
