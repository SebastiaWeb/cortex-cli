import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithRetry } from '../../src/lib/http-retry.js';

function res(status: number, headers: Record<string, string> = {}): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers) } as Response;
}

describe('fetchWithRetry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns immediately on a successful response, no retries', async () => {
    const fetchFn = vi.fn(async () => res(200));
    vi.stubGlobal('fetch', fetchFn);

    const sleep = vi.fn(async () => {});
    const out = await fetchWithRetry('https://example.com', undefined, { sleep });

    expect(out.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry a plain 404 or 401', async () => {
    const fetchFn = vi.fn(async () => res(404));
    vi.stubGlobal('fetch', fetchFn);
    const sleep = vi.fn(async () => {});

    const out = await fetchWithRetry('https://example.com', undefined, { sleep });

    expect(out.status).toBe(404);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries on a 500 and succeeds once the server recovers', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => (call++ === 0 ? res(500) : res(200)));
    vi.stubGlobal('fetch', fetchFn);
    const sleep = vi.fn(async () => {});

    const out = await fetchWithRetry('https://example.com', undefined, { sleep, retries: 3 });

    expect(out.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('retries on a 429', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => (call++ === 0 ? res(429) : res(200)));
    vi.stubGlobal('fetch', fetchFn);

    const out = await fetchWithRetry('https://example.com', undefined, { sleep: async () => {}, retries: 3 });

    expect(out.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries on a rate-limited 403 (X-RateLimit-Remaining: 0) but not a permission 403', async () => {
    const fetchFn = vi.fn(async () => res(403, { 'x-ratelimit-remaining': '0' }));
    vi.stubGlobal('fetch', fetchFn);
    const sleep = vi.fn(async () => {});

    await fetchWithRetry('https://example.com', undefined, { sleep, retries: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(3); // initial + 2 retries, exhausted

    vi.unstubAllGlobals();
    const fetchFn2 = vi.fn(async () => res(403));
    vi.stubGlobal('fetch', fetchFn2);
    const sleep2 = vi.fn(async () => {});
    const out = await fetchWithRetry('https://example.com', undefined, { sleep: sleep2, retries: 2 });
    expect(out.status).toBe(403);
    expect(fetchFn2).toHaveBeenCalledTimes(1);
    expect(sleep2).not.toHaveBeenCalled();
  });

  it('retries on a thrown network error and eventually rethrows if it never recovers', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('network down'); });
    vi.stubGlobal('fetch', fetchFn);
    const sleep = vi.fn(async () => {});

    await expect(fetchWithRetry('https://example.com', undefined, { sleep, retries: 2 })).rejects.toThrow('network down');
    expect(fetchFn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('gives up after exhausting retries and returns the last error response', async () => {
    const fetchFn = vi.fn(async () => res(503));
    vi.stubGlobal('fetch', fetchFn);
    const sleep = vi.fn(async () => {});

    const out = await fetchWithRetry('https://example.com', undefined, { sleep, retries: 2 });

    expect(out.status).toBe(503);
    expect(fetchFn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('backs off exponentially', async () => {
    const fetchFn = vi.fn(async () => res(500));
    vi.stubGlobal('fetch', fetchFn);
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => { delays.push(ms); });

    await fetchWithRetry('https://example.com', undefined, { sleep, retries: 3, baseDelayMs: 100 });

    expect(delays).toEqual([100, 200, 400]);
  });
});
