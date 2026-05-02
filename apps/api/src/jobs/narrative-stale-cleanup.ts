import { privilegedSql } from '@cpa/db/client';

/**
 * P6 Task 5.7 — stale-streaming-cleanup background job.
 *
 * Reaps `narrative_draft` rows stuck in `status='streaming'` with no
 * recent activity. The narrative-drafter SSE endpoint (Task 5.5) only
 * persists drafts after the stream completes, so a stuck-streaming row
 * indicates the server crashed mid-persistence OR a future
 * incremental-persist codepath orphaned a row.
 *
 * The contract: keep whatever segments we have; flip the row to
 * `complete` so consumers stop treating it as in-flight. The audit
 * trail (`NARRATIVE_DRAFTED` event chain) may be empty for these rows
 * — downstream consumers should compute completeness via segment
 * presence rather than blindly trusting `status`.
 *
 * Threshold: 10 minutes since last `updated_at`. Generous because
 * Anthropic Sonnet narrative streams typically run 30-90 seconds; 10
 * minutes leaves comfortable headroom for slow networks + retries.
 * Override via `P6_NARRATIVE_STALE_THRESHOLD_MIN` (mostly for tests
 * that need to flip a row stale on a sub-minute timescale).
 *
 * Designed to be wired into pg-boss as an hourly cron (deferred — the
 * pg-boss server itself isn't bootstrapped in this codebase yet, so
 * this module just exposes a callable handler in the same shape as
 * `audit-score-recompute.recomputeAllActive`).
 *
 * Uses `privilegedSql` because the cron worker has no tenant GUC; the
 * UPDATE is intentionally cross-tenant — every firm's stale streaming
 * drafts get reaped in a single pass. Reading or writing
 * `narrative_draft` via the cpa_app client without setting the GUC
 * would fail-safe to "deny everything" via the RLS policy.
 */

export type NarrativeStaleCleanupResult = {
  /** Number of `narrative_draft` rows flipped from `streaming` → `complete`. */
  rows_flipped: number;
};

/** Default threshold (minutes) — overridden by P6_NARRATIVE_STALE_THRESHOLD_MIN. */
const DEFAULT_STALE_THRESHOLD_MINUTES = 10;

/**
 * Resolve the stale-threshold (in minutes) from env, falling back to
 * the default. Read at call time (not module-load) so test cases can
 * flip the env var inside a single process.
 */
function resolveStaleThresholdMinutes(): number {
  const raw = process.env['P6_NARRATIVE_STALE_THRESHOLD_MIN'];
  if (raw === undefined || raw === '') return DEFAULT_STALE_THRESHOLD_MINUTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_STALE_THRESHOLD_MINUTES;
  return parsed;
}

/**
 * Sweep `narrative_draft` for rows where `status='streaming'` AND
 * `updated_at < now() - threshold`; flip them to `status='complete'`.
 * Returns a count of flipped rows so the cron worker (or a test) can
 * surface telemetry.
 *
 * Idempotent: a second invocation with no new activity reaps zero rows.
 */
export async function runNarrativeStaleCleanup(): Promise<NarrativeStaleCleanupResult> {
  const minutes = resolveStaleThresholdMinutes();
  // Build the interval string in TS (postgres-js binds the value as a
  // text literal, then we cast to interval). Avoids needing a numeric
  // parameterised interval (which postgres-js doesn't support cleanly).
  const intervalLiteral = `${minutes} minutes`;
  const rows = await privilegedSql<{ id: string }[]>`
    UPDATE narrative_draft
       SET status = 'complete'
     WHERE status = 'streaming'
       AND updated_at < now() - ${intervalLiteral}::interval
    RETURNING id
  `;
  return { rows_flipped: rows.length };
}
