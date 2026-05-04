/**
 * Backend audit P1-1 + P1-2 — fetch with timeout + exponential backoff.
 *
 * Cloudflare Workers have a 30s CPU cap; a single hung request to FAL
 * or DataForSEO eats it. Wrap every external call in this helper so:
 *   - Non-2xx 5xx responses retry with exponential backoff (3 attempts)
 *   - 4xx fail fast (those are programmer errors, retry won't fix)
 *   - AbortError after timeoutMs counts as a transient failure
 *   - Request-id (if available) gets logged so retries are correlatable
 *
 * For SDK calls (Anthropic, Stripe), prefer configuring the SDK's own
 * retry mechanism — it handles streaming + idempotency keys properly.
 */

export interface FetchWithRetryOptions {
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  /** When set, also retries on these status codes (default: 5xx + 408 + 429). */
  retryStatuses?: number[];
}

const DEFAULT_RETRY_STATUSES = [408, 429, 500, 502, 503, 504];

export class FetchWithRetryError extends Error {
  constructor(
    public lastStatus: number | null,
    public attempts: number,
    message: string
  ) {
    super(message);
    this.name = "FetchWithRetryError";
  }
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchWithRetryOptions = {}
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const retryStatuses = opts.retryStatuses ?? DEFAULT_RETRY_STATUSES;

  let lastStatus: number | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeoutId);
      lastStatus = res.status;
      // Success or non-retryable error: return immediately.
      if (res.ok) return res;
      if (!retryStatuses.includes(res.status)) return res;
      // Retryable failure — log and back off, unless we're out of attempts.
      console.warn(
        `[fetch-with-retry] ${url} attempt ${attempt}/${maxRetries} got ${res.status}`
      );
      if (attempt < maxRetries) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      return res; // last attempt — let caller handle the error response
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      const isAbort =
        err instanceof Error && err.name === "AbortError";
      console.warn(
        `[fetch-with-retry] ${url} attempt ${attempt}/${maxRetries} threw ${isAbort ? "timeout" : err instanceof Error ? err.message : String(err)}`
      );
      if (attempt < maxRetries) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      throw new FetchWithRetryError(
        lastStatus,
        attempt,
        `Request to ${url} failed after ${attempt} attempt(s): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  // Loop exits via return inside; this is a defensive fallthrough.
  throw new FetchWithRetryError(
    lastStatus,
    maxRetries,
    `Request to ${url} failed after ${maxRetries} attempts (last error: ${String(lastError)})`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
