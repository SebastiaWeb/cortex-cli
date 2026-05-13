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
      // "hello" in base64 = "aGVsbG8=" — GitHub may insert newlines
      const wrapped = 'aGVs\nbG8=';
      vi.stubGlobal('fetch', mockFetch([{ status: 200, body: { sha: 'abc', content: wrapped } }]));
      const buf = await backend.read('test.bin');
      expect(buf.toString('utf-8')).toBe('hello');
    });

    it('throws on non-200', async () => {
      vi.stubGlobal('fetch', mockFetch([{ status: 404, body: {} }]));
      await expect(backend.read('missing')).rejects.toThrow('404');
    });
  });

  describe('write()', () => {
    it('creates new file when not exists (no sha in PUT)', async () => {
      const calls: Array<{ method?: string; body?: string }> = [];
      const fetchMock = vi.fn().mockImplementation((url: string, opts: RequestInit) => {
        calls.push({ method: opts?.method ?? 'GET', body: opts?.body as string });
        // First call: GET to check sha → 404 (new file)
        // Second call: PUT → 201
        const isGet = (opts?.method ?? 'GET') === 'GET';
        return Promise.resolve({
          ok: isGet ? false : true,
          status: isGet ? 404 : 201,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve(''),
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      await backend.write('files/test.bin', Buffer.from('data'));

      expect(calls).toHaveLength(2);
      const putBody = JSON.parse(calls[1].body!) as { sha?: string; content: string; message: string };
      expect(putBody.sha).toBeUndefined(); // new file — no sha
      expect(putBody.content).toBe(Buffer.from('data').toString('base64'));
    });

    it('includes sha in PUT when file already exists', async () => {
      const existingSha = 'existing-sha-abc';
      const calls: Array<{ method?: string; body?: string }> = [];
      const fetchMock = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
        const method = opts?.method ?? 'GET';
        calls.push({ method, body: opts?.body as string });
        const isGet = method === 'GET';
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(isGet ? { sha: existingSha, content: '' } : {}),
          text: () => Promise.resolve(''),
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      await backend.write('files/existing.bin', Buffer.from('updated'));

      const putBody = JSON.parse(calls[1].body!) as { sha: string };
      expect(putBody.sha).toBe(existingSha);
    });
  });

  describe('remove()', () => {
    it('is idempotent on missing file (no DELETE call)', async () => {
      const fetchMock = mockFetch([{ status: 404, body: {} }]);
      vi.stubGlobal('fetch', fetchMock);

      await expect(backend.remove('missing')).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1); // only GET, no DELETE
    });

    it('issues DELETE with sha for existing file', async () => {
      const sha = 'del-sha-123';
      let deleteCalled = false;
      const fetchMock = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
        const method = opts?.method ?? 'GET';
        if (method === 'DELETE') deleteCalled = true;
        const isGet = method === 'GET';
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(isGet ? { sha, content: '' } : {}),
          text: () => Promise.resolve(''),
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      await backend.remove('files/old.bin');
      expect(deleteCalled).toBe(true);
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
