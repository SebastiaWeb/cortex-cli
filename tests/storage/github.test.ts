import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubBackend, fetchGitHubUser, ensureGitHubRepo } from '../../src/storage/github.js';

const TOKEN = 'ghp_test_token';
const OWNER = 'testuser';
const REPO = 'cortex-backup';

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  let idx = 0;
  return vi.fn().mockImplementation(() => {
    const r = responses[idx++] ?? { status: 200, body: {} };
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: () => Promise.resolve(r.body),
      text: () => Promise.resolve(JSON.stringify(r.body)),
    });
  });
}

interface Route {
  method: string;
  test: (url: string) => boolean;
  status?: number;
  body?: unknown | ((callIndexForRoute: number) => unknown);
}

/** Dispatches by method + URL pattern instead of call order — clearer for
 * the multi-step Git Data API flow (ref → commit → blobs → tree → commit → ref). */
function mockFetchRoute(routes: Route[]) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const routeCallCounts = new Map<Route, number>();
  const fn = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    const method = opts?.method ?? 'GET';
    const parsedBody = opts?.body ? JSON.parse(opts.body as string) : undefined;
    calls.push({ method, url, body: parsedBody });
    const route = routes.find((r) => r.method === method && r.test(url));
    if (!route) throw new Error(`Unmocked request: ${method} ${url}`);
    const n = routeCallCounts.get(route) ?? 0;
    routeCallCounts.set(route, n + 1);
    const resolvedBody = typeof route.body === 'function' ? (route.body as (n: number) => unknown)(n) : (route.body ?? {});
    const status = route.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(resolvedBody),
      text: () => Promise.resolve(JSON.stringify(resolvedBody)),
    });
  });
  return { fn, calls };
}

const REPO_INFO_ROUTE: Route = { method: 'GET', test: (u) => /\/repos\/[^/]+\/[^/]+$/.test(u), body: { default_branch: 'main' } };
const GET_REF_ROUTE = (sha: string): Route => ({ method: 'GET', test: (u) => u.includes('/git/refs/heads/main'), body: { object: { sha } } });
const GET_COMMIT_ROUTE = (treeSha: string): Route => ({ method: 'GET', test: (u) => /\/git\/commits\/[^/]+$/.test(u), body: { tree: { sha: treeSha } } });
const CREATE_BLOB_ROUTE: Route = {
  method: 'POST',
  test: (u) => u.endsWith('/git/blobs'),
  status: 201,
  body: (n: number) => ({ sha: `blob-sha-${n}` }),
};
const CREATE_TREE_ROUTE = (sha: string): Route => ({ method: 'POST', test: (u) => u.endsWith('/git/trees'), status: 201, body: { sha } });
const CREATE_COMMIT_ROUTE = (sha: string): Route => ({ method: 'POST', test: (u) => u.endsWith('/git/commits'), status: 201, body: { sha } });
const UPDATE_REF_ROUTE: Route = { method: 'PATCH', test: (u) => u.includes('/git/refs/heads/main') };

describe('GitHubBackend', () => {
  let backend: GitHubBackend;

  beforeEach(() => {
    backend = new GitHubBackend(TOKEN, OWNER, REPO);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('name includes owner/repo', () => {
    expect(backend.name).toBe(`GitHub (${OWNER}/${REPO})`);
  });

  describe('has()', () => {
    it('returns true when file exists (200)', async () => {
      vi.stubGlobal('fetch', mockFetch([{ status: 200, body: { sha: 'abc', content: '' } }]));
      expect(await backend.has('manifest.json.enc')).toBe(true);
    });

    it('returns false on 404', async () => {
      vi.stubGlobal('fetch', mockFetch([{ status: 404, body: {} }]));
      expect(await backend.has('missing')).toBe(false);
    });
  });

  describe('read()', () => {
    it('decodes base64 content (GitHub wraps at 60 chars)', async () => {
      // "hello" in base64 = "aGVsbG8=" — GitHub may insert newlines.
      // read() now goes via the Blobs API: GET contents metadata (sha) → GET blob (content).
      const wrapped = 'aGVs\nbG8=';
      vi.stubGlobal(
        'fetch',
        mockFetch([
          { status: 200, body: { sha: 'abc' } },
          { status: 200, body: { content: wrapped, encoding: 'base64' } },
        ]),
      );
      const buf = await backend.read('test.bin');
      expect(buf.toString('utf-8')).toBe('hello');
    });

    it('throws on non-200', async () => {
      vi.stubGlobal('fetch', mockFetch([{ status: 404, body: {} }]));
      await expect(backend.read('missing')).rejects.toThrow('404');
    });
  });

  describe('read() on large files', () => {
    it('fetches full content via the Blobs API when Contents metadata omits it (>1MB)', async () => {
      // Contents API GET omits `content` for files over 1MB but still returns `sha` —
      // this is exactly the bug that broke pull/status for 7 of 16 real sessions.
      const wrapped = 'aGVs\nbG8='; // "hello", GitHub wraps base64 at 60 chars
      const calls: string[] = [];
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        calls.push(url);
        if (url.includes('/git/blobs/')) {
          return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({ content: wrapped, encoding: 'base64' }),
            text: () => Promise.resolve(''),
          });
        }
        // Contents metadata GET — no `content` field, simulating a >1MB file
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ sha: 'big-file-sha' }),
          text: () => Promise.resolve(''),
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      const buf = await backend.read('big-session.jsonl');

      expect(buf.toString('utf-8')).toBe('hello');
      expect(calls.some((u) => u.includes('/git/blobs/big-file-sha'))).toBe(true);
    });

    it('throws when the file does not exist', async () => {
      vi.stubGlobal('fetch', mockFetch([{ status: 404, body: {} }]));
      await expect(backend.read('missing')).rejects.toThrow(/404/);
    });
  });

  describe('writeMany()', () => {
    it('does nothing for an empty batch', async () => {
      const { fn } = mockFetchRoute([]);
      vi.stubGlobal('fetch', fn);
      await backend.writeMany([]);
      expect(fn).not.toHaveBeenCalled();
    });

    it('creates one commit containing a blob per file', async () => {
      const { fn, calls } = mockFetchRoute([
        REPO_INFO_ROUTE,
        GET_REF_ROUTE('parent-commit-sha'),
        GET_COMMIT_ROUTE('base-tree-sha'),
        CREATE_BLOB_ROUTE,
        CREATE_TREE_ROUTE('new-tree-sha'),
        CREATE_COMMIT_ROUTE('new-commit-sha'),
        UPDATE_REF_ROUTE,
      ]);
      vi.stubGlobal('fetch', fn);

      await backend.writeMany([
        { path: 'files/a.txt', content: Buffer.from('AAA') },
        { path: 'files/b.txt', content: Buffer.from('BBB') },
      ]);

      const blobCalls = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/git/blobs'));
      expect(blobCalls).toHaveLength(2); // one blob per file — not one commit per file

      const treeCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/trees'))!;
      const treeBody = treeCall.body as { base_tree: string; tree: Array<{ path: string; sha: string }> };
      expect(treeBody.base_tree).toBe('base-tree-sha');
      expect(treeBody.tree.map((e) => e.path).sort()).toEqual(['files/a.txt', 'files/b.txt']);

      const commitCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/commits'))!;
      const commitBody = commitCall.body as { tree: string; parents: string[] };
      expect(commitBody.tree).toBe('new-tree-sha');
      expect(commitBody.parents).toEqual(['parent-commit-sha']);

      const refCall = calls.find((c) => c.method === 'PATCH')!;
      expect((refCall.body as { sha: string }).sha).toBe('new-commit-sha');
    });
  });

  describe('removeMany()', () => {
    it('does nothing for an empty batch', async () => {
      const { fn } = mockFetchRoute([]);
      vi.stubGlobal('fetch', fn);
      await backend.removeMany([]);
      expect(fn).not.toHaveBeenCalled();
    });

    it('creates one commit deleting all given paths (sha: null in the tree)', async () => {
      const { fn, calls } = mockFetchRoute([
        REPO_INFO_ROUTE,
        GET_REF_ROUTE('parent-commit-sha'),
        GET_COMMIT_ROUTE('base-tree-sha'),
        CREATE_TREE_ROUTE('new-tree-sha'),
        CREATE_COMMIT_ROUTE('new-commit-sha'),
        UPDATE_REF_ROUTE,
      ]);
      vi.stubGlobal('fetch', fn);

      await backend.removeMany(['files/old-a.txt', 'files/old-b.txt']);

      const treeCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/trees'))!;
      const treeBody = treeCall.body as { tree: Array<{ path: string; sha: unknown }> };
      expect(treeBody.tree.every((e) => e.sha === null)).toBe(true);
      expect(treeBody.tree.map((e) => e.path).sort()).toEqual(['files/old-a.txt', 'files/old-b.txt']);
    });
  });

  describe('write() / remove() (single-file wrappers)', () => {
    it('write() commits exactly the one file given', async () => {
      const { fn, calls } = mockFetchRoute([
        REPO_INFO_ROUTE,
        GET_REF_ROUTE('parent'),
        GET_COMMIT_ROUTE('base-tree'),
        CREATE_BLOB_ROUTE,
        CREATE_TREE_ROUTE('tree2'),
        CREATE_COMMIT_ROUTE('commit2'),
        UPDATE_REF_ROUTE,
      ]);
      vi.stubGlobal('fetch', fn);

      await backend.write('files/solo.txt', Buffer.from('solo'));

      const treeCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/trees'))!;
      expect((treeCall.body as { tree: Array<{ path: string }> }).tree).toEqual([{ path: 'files/solo.txt', mode: '100644', type: 'blob', sha: 'blob-sha-0' }]);
    });

    it('remove() commits a deletion for exactly the one path given', async () => {
      const { fn, calls } = mockFetchRoute([
        REPO_INFO_ROUTE,
        GET_REF_ROUTE('parent'),
        GET_COMMIT_ROUTE('base-tree'),
        CREATE_TREE_ROUTE('tree2'),
        CREATE_COMMIT_ROUTE('commit2'),
        UPDATE_REF_ROUTE,
      ]);
      vi.stubGlobal('fetch', fn);

      await backend.remove('files/gone.txt');

      const treeCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/trees'))!;
      expect((treeCall.body as { tree: Array<{ path: string; sha: unknown }> }).tree).toEqual([{ path: 'files/gone.txt', mode: '100644', type: 'blob', sha: null }]);
    });
  });

  describe('list()', () => {
    it('returns blobs from git tree', async () => {
      const tree = [
        { path: 'manifest.json.enc', type: 'blob', size: 128 },
        { path: 'files/settings.json', type: 'blob', size: 64 },
        { path: 'some-dir', type: 'tree' },
      ];
      vi.stubGlobal('fetch', mockFetch([{ status: 200, body: { tree } }]));
      const files = await backend.list();
      expect(files.map((f) => f.path).sort()).toEqual([
        'files/settings.json',
        'manifest.json.enc',
      ]);
    });

    it('returns [] on empty repo (404)', async () => {
      vi.stubGlobal('fetch', mockFetch([{ status: 404, body: {} }]));
      expect(await backend.list()).toEqual([]);
    });

    it('returns [] on 409 (repo exists but has no commits)', async () => {
      vi.stubGlobal('fetch', mockFetch([{ status: 409, body: {} }]));
      expect(await backend.list()).toEqual([]);
    });
  });
});

describe('fetchGitHubUser', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the login from /user response', async () => {
    vi.stubGlobal('fetch', mockFetch([{ status: 200, body: { login: 'myuser' } }]));
    expect(await fetchGitHubUser('ghp_test')).toBe('myuser');
  });

  it('throws on invalid token (401)', async () => {
    vi.stubGlobal('fetch', mockFetch([{ status: 401, body: {} }]));
    await expect(fetchGitHubUser('bad-token')).rejects.toThrow('401');
  });
});

describe('ensureGitHubRepo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves on 201 (created)', async () => {
    vi.stubGlobal('fetch', mockFetch([{ status: 201, body: { name: 'cortex-backup' } }]));
    await expect(ensureGitHubRepo('ghp_test', 'cortex-backup')).resolves.toBeUndefined();
  });

  it('resolves on 422 (repo already exists)', async () => {
    vi.stubGlobal('fetch', mockFetch([{ status: 422, body: { message: 'already exists' } }]));
    await expect(ensureGitHubRepo('ghp_test', 'cortex-backup')).resolves.toBeUndefined();
  });

  it('throws on other errors', async () => {
    vi.stubGlobal('fetch', mockFetch([{ status: 500, body: { message: 'server error' } }]));
    await expect(ensureGitHubRepo('ghp_test', 'cortex-backup')).rejects.toThrow('500');
  });
});
