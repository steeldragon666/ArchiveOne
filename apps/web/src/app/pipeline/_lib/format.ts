/**
 * Shared formatting helpers for pipeline views (kanban + table).
 *
 * Pure functions — no React imports — so test files import directly without
 * pulling component module graph. Extracted from `pipeline-kanban.tsx` in C3
 * to avoid duplicating the same date math across the table view.
 */

/**
 * Format an ISO-8601 timestamp as a relative-time English phrase
 * ("3 mins ago", "2 days ago"). Pure for testability. Caps at "30+ days
 * ago" — older entries probably shouldn't be in the active pipeline anyway.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return '30+ days ago';
}

/**
 * Days-in-stage approximation — true value would compute from the most
 * recent CLAIM_STAGE_ADVANCED event's captured_at, but A2's GET /v1/claims
 * doesn't yet return that field. Using `claim.updated_at` as a stand-in is
 * close enough for the UI (any non-stage update on the claim row also bumps
 * updated_at, but that's rare in normal usage and the column is a sortable
 * hint, not a system-of-record value).
 *
 * TODO(A2): replace with `now - last_stage_change.captured_at` once the
 * GET endpoint returns the last-stage-change event.
 */
export function daysInStage(updatedAtIso: string, now: Date = new Date()): number {
  const then = new Date(updatedAtIso).getTime();
  const diffMs = now.getTime() - then;
  if (!Number.isFinite(diffMs) || diffMs < 0) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
