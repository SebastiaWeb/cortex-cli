export interface RetryOptions {
  /** Number of retries after the initial attempt. Default 3. */
  retries?: number;
  /** Base delay in ms for exponential backoff (doubles each retry). Default 300. */
  baseDelayMs?: number;
  /** Injectable for tests — defaults to a real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

function isRetryableStatus(res: Response): boolean {
  if (res.status === 429) return true;
  if (res.status >= 500) return true;
  // GitHub returns 403 for both a real permission error and a rate limit —
  // only the rate-limit case is worth retrying.
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') return true;
  return false;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch() with exponential backoff on transient failures (429, 5xx, GitHub's
 * rate-limited 403, and thrown network errors). Non-retryable responses
 * (404, 401, a permission 403, etc.) return on the first attempt.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit | undefined,
  opts: RetryOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 300;
  const sleep = opts.sleep ?? realSleep;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if (attempt >= retries) throw e;
      await sleep(baseDelayMs * 2 ** attempt);
      continue;
    }
    if (attempt >= retries || !isRetryableStatus(res)) return res;
    await sleep(baseDelayMs * 2 ** attempt);
  }
}
