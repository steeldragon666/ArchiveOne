/**
 * P7 Theme D Task D.13 — Shared resilient fetch helper for RIF connectors.
 *
 * Provides:
 *   - Standard User-Agent and Accept headers identifying the bot per
 *     webmaster norms (includes contact URL and email).
 *   - 30-second timeout via AbortController on every attempt.
 *   - Exponential backoff retry on 5xx responses: delays of 1s, 2s, 4s
 *     (max 3 attempts total). 4xx errors are NOT retried — they are
 *     deterministic failures that require operator action.
 *   - Retry-After header honour on 429 responses (up to 60s wait).
 *
 * HTTP status semantics surfaced via thrown Error messages:
 *   403  → message prefixed with "[bot-blocked]"   → classifyError → network_error
 *   404  → message prefixed with "[url-stale]"     → classifyError → parse_error
 *   429  → message prefixed with "[rate-limited]"  → classifyError → rate_limited
 *   5xx  → retried; if all attempts fail → network_error
 */

/** Identifies the bot and supplies a contact URL for webmaster blocks. */
export const RIF_USER_AGENT =
  'Claimsure RIF/1.0 (https://claimsure.com.au/contact; bot@claimsure.com.au)';

/** Accept header suitable for both RSS/Atom feeds and HTML pages. */
const ACCEPT_HEADER =
  'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8';

/** Maximum number of fetch attempts (1 initial + 2 retries = 3 total). */
const MAX_ATTEMPTS = 3;

/** Base backoff delay in ms. Doubled on each retry: 1000, 2000, 4000. */
const BASE_BACKOFF_MS = 1_000;

/** Maximum Retry-After delay we will honour (seconds). */
const MAX_RETRY_AFTER_S = 60;

/** Per-attempt fetch timeout. */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Fetch a URL with retry/backoff resilience and standard RIF headers.
 *
 * Merges caller-supplied headers on top of the defaults so individual
 * connectors can add Accept overrides if needed.
 *
 * @param url     - The URL to fetch.
 * @param options - Optional fetch init overrides (headers merged, not replaced).
 * @returns       Resolved Response on 2xx.
 * @throws        Error with diagnostic prefix on 4xx/5xx exhaustion.
 */
export async function rifFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const mergedHeaders: Record<string, string> = {
    'User-Agent': RIF_USER_AGENT,
    Accept: ACCEPT_HEADER,
    // Caller overrides (e.g. Accept for RSS-only endpoints)
    ...(options.headers as Record<string, string> | undefined),
  };

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await globalThis.fetch(url, {
        ...options,
        headers: mergedHeaders,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      lastError = new Error(`fetch failed on attempt ${attempt}/${MAX_ATTEMPTS}: ${msg}`);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeoutId);
    }

    // Success
    if (response.ok) return response;

    // 429 — rate limited: honour Retry-After then retry
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const waitSeconds = parseRetryAfter(retryAfterHeader);
      const clampedWait = Math.min(waitSeconds, MAX_RETRY_AFTER_S);
      lastError = new Error(`[rate-limited] HTTP 429 from ${url} (Retry-After: ${clampedWait}s)`);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(clampedWait * 1_000);
        continue;
      }
      throw lastError;
    }

    // 403 — bot-blocked: not retryable
    if (response.status === 403) {
      throw new Error(`[bot-blocked] HTTP 403 from ${url} — bot detection triggered`);
    }

    // 404 — URL stale: not retryable
    if (response.status === 404) {
      throw new Error(`[url-stale] HTTP 404 from ${url} — source URL has moved`);
    }

    // 5xx — transient server error: retry with backoff
    if (response.status >= 500) {
      lastError = new Error(
        `HTTP ${response.status} from ${url} on attempt ${attempt}/${MAX_ATTEMPTS}`,
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt - 1));
        continue;
      }
      throw lastError;
    }

    // Other 4xx (400, 401, 410, etc.) — not retryable
    throw new Error(`HTTP ${response.status} from ${url} — not retryable`);
  }

  // Should never reach here, but TypeScript needs the throw
  throw lastError ?? new Error(`rifFetch exhausted retries for ${url}`);
}

/**
 * Parse a Retry-After header value into seconds.
 * Accepts both integer seconds and HTTP-date formats.
 * Returns a minimum of 1 second to avoid immediate retry.
 */
function parseRetryAfter(header: string | null): number {
  if (!header) return BASE_BACKOFF_MS / 1_000;
  const asInt = parseInt(header, 10);
  if (!isNaN(asInt) && asInt > 0) return asInt;
  const asDate = new Date(header);
  if (!isNaN(asDate.getTime())) {
    const diffSeconds = Math.ceil((asDate.getTime() - Date.now()) / 1_000);
    return Math.max(1, diffSeconds);
  }
  return BASE_BACKOFF_MS / 1_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
