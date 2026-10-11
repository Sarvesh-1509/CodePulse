import {
  invalidResponse,
  networkFailure,
  rateLimited,
  upstreamFailure,
  upstreamTimeout,
  type PlatformError,
} from "./errors";

/**
 * Shared upstream HTTP helper for platform adapters (Modules 4-5).
 *
 * - Fixed caller-supplied URLs only. Adapters must never build request URLs
 *   from user input (SSRF guard); usernames travel in query params / bodies.
 * - AbortController timeout on every request (no hanging syncs).
 * - Bounded retries for transient failures only (network errors, timeouts,
 *   HTTP 5xx): at most `maxRetries` extra attempts with linear backoff.
 *   Permanent failures (4xx, API-level rejections) are never retried.
 * - Safe JSON parsing: malformed bodies become `invalid-response`, never a
 *   thrown SyntaxError with payload fragments.
 */
export interface FetchUpstreamOptions {
  timeoutMs: number;
  /** Extra attempts after the first try. 0 = no retries. */
  maxRetries?: number;
  retryDelayMs?: number;
  init?: RequestInit;
  /**
   * Return HTTP 400 responses instead of throwing, so callers can inspect
   * API-level error envelopes that ride on 400 (Codeforces returns its
   * FAILED envelope with HTTP 400 for unknown handles). Other 4xx still
   * throw. Permanent-failure semantics are unchanged: 400s are never
   * retried either way.
   */
  passBadRequestThrough?: boolean;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function fetchUpstream(
  url: string,
  options: FetchUpstreamOptions
): Promise<Response> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const res = await fetch(url, { ...options.init, signal: controller.signal });
      clearTimeout(timer);

      if (res.ok) return res;
      if (res.status === 400 && options.passBadRequestThrough) return res;
      if (res.status === 429) {
        throw rateLimited(
          "The platform is rate-limiting requests. Please try again later."
        );
      }
      if (isTransientStatus(res.status) && attempt < maxRetries) {
        attempt += 1;
        await sleep(retryDelayMs * attempt);
        continue;
      }
      throw upstreamFailure(`The platform returned HTTP ${res.status}.`);
    } catch (err) {
      clearTimeout(timer);
      // Pass through errors we already classified (rate-limited, upstream).
      if (isPlatformError(err)) throw err;
      const aborted =
        err instanceof DOMException ? err.name === "AbortError" : false;
      const transient =
        aborted ||
        (err instanceof TypeError &&
          /fetch failed|network|socket|ECONN|ENOTFOUND|ETIMEDOUT/i.test(
            String((err as Error).message)
          ));
      if (transient && attempt < maxRetries) {
        attempt += 1;
        await sleep(retryDelayMs * attempt);
        continue;
      }
      if (aborted || /aborted|timeout/i.test(String((err as Error)?.message))) {
        throw upstreamTimeout("The platform request timed out. Please try again.");
      }
      throw networkFailure("Could not reach the platform. Please try again later.");
    }
  }
}

/** Parse JSON bodies safely; malformed payloads become invalid-response. */
export async function parseJsonSafe<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw invalidResponse("The platform returned an unreadable response.");
  }
}

/**
 * Test seam: swap the global fetch used by fetchUpstream within `fn`.
 * Production code always uses the real global fetch.
 */
export async function withFetchStub<T>(
  stub: typeof fetch,
  fn: () => Promise<T>
): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

function isPlatformError(err: unknown): err is PlatformError {
  return (
    typeof err === "object" &&
    err !== null &&
    "kind" in err &&
    typeof (err as { kind: unknown }).kind === "string"
  );
}
