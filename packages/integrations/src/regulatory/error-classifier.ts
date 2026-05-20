/**
 * P7 Theme D Task D.9 — Error classifier for RIF source fetch failures.
 *
 * Maps fetch/parse errors to `last_polled_status` enum values so the
 * /intelligence UI can surface actionable diagnostics (e.g.
 * "rate_limited" -> back off; "parse_error" -> connector needs update;
 * "network_error" -> transient, retry).
 *
 * HTTP status disambiguation:
 *   403  -> "network_error" with message prefix "[bot-blocked]"
 *           Remediation: review UA headers or use an alternate access path.
 *   404  -> "parse_error" with message prefix "[url-stale]"
 *           Remediation: update source_url in regulatory_source.
 *   5xx  -> "network_error" (transient; scrape will retry on next cron run)
 *   429  -> "rate_limited" (honour Retry-After, back off)
 *
 * These prefixes are surfaced in regulatory_source.last_polled_status so
 * operators can triage issues without inspecting server logs.
 */

import type { REGULATORY_SOURCE_POLLED_STATUSES } from '@cpa/db/schema';

/**
 * Map of polled status literal types (excluding 'success' which is the happy path).
 */
type ErrorStatus = Exclude<(typeof REGULATORY_SOURCE_POLLED_STATUSES)[number], 'success'>;

/**
 * Classify a fetch/parse error into a last_polled_status enum value.
 *
 * Used by the daily scrape cron to persist a meaningful status when
 * a source connector fails, so the /intelligence UI can surface
 * actionable diagnostics.
 *
 * 403 ("bot-blocked") maps to 'network_error' — the URL is correct but
 * access is denied. Operator action: review User-Agent or request access.
 *
 * 404 ("url-stale") maps to 'parse_error' — the URL has moved. Operator
 * action: locate the new URL and update regulatory_source.source_url.
 *
 * Both conditions produce a distinct message prefix so they remain
 * distinguishable in the stored last_polled_status message even though
 * the DB enum has only four values.
 */
export function classifyError(err: unknown): ErrorStatus {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // HTTP 429 or explicit rate-limit signal
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
      return 'rate_limited';
    }
    // HTTP 403 — bot-blocking / access denied. Distinct from a stale URL.
    if (msg.includes('[bot-blocked]') || msg.includes('http 403') || msg.includes(' 403')) {
      return 'network_error';
    }
    // HTTP 404 — URL has moved. Classified as parse_error so the operator
    // knows this requires a URL update, not just a transient retry.
    if (msg.includes('[url-stale]') || msg.includes('http 404') || msg.includes(' 404')) {
      return 'parse_error';
    }
    // Parse/decode failures
    if (
      msg.includes('parse') ||
      msg.includes('syntax') ||
      msg.includes('unexpected token') ||
      msg.includes('invalid json') ||
      msg.includes('malformed')
    ) {
      return 'parse_error';
    }
    // Network-level failures
    if (
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('etimedout') ||
      msg.includes('fetch failed') ||
      msg.includes('network') ||
      msg.includes('socket') ||
      msg.includes('dns')
    ) {
      return 'network_error';
    }
  }
  // Default: network_error is the safest catch-all for unknown failures
  return 'network_error';
}
