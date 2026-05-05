import { isAgentEnabled, isTenantAllowed } from '@cpa/agents';
import {
  runExpenditureClassifyJob,
  type ExpenditureClassifyJobResult,
} from '../jobs/expenditure-classify.js';

/**
 * Enqueue an expenditure-classify run for a batch of expenditure ids
 * (Task 3.4 / 3.5 — Agent A trigger seam).
 *
 * **Why a shim and not a direct call?** Two reasons:
 *
 *   1. **Single source of truth for the feature-flag + allowlist gates.**
 *      Both call sites (the Xero ingest hook and the manual-reclassify
 *      route) need the same `isAgentEnabled('A') && isTenantAllowed(...)`
 *      gating. Co-locating it here means a future fourth call site
 *      cannot forget either gate, and the gate can evolve in one place.
 *      The job processor itself ALSO checks the gates as defense-in-depth
 *      (see `runExpenditureClassifyJob`); this layer just short-circuits
 *      before we even build the call.
 *
 *   2. **Single seam for future pg-boss adoption.** The design spec calls
 *      for `pgBoss.send('expenditure-classify', { ... })`, but pg-boss is
 *      not yet bootstrapped in this codebase (see the header comments in
 *      `xero-accounting-sync.ts`, `daily-capture-push.ts`, and
 *      `transcribe.ts` for the documented "handler-first, subscriber-
 *      later" convention). When the cross-cutting bootstrap task lands
 *      `pgBoss.start()` in `server.ts`, ONLY this file changes — the
 *      call sites stay put.
 *
 * **Fire-and-forget semantics.** Production callers wrap the call as
 * `void enqueueExpenditureClassify(...).catch(...)` so the parent
 * operation continues immediately. Classification is not part of the
 * EXPENDITURE_INGESTED contract — a thrown classifier (model timeout,
 * cache write race, downstream chain error) must not fail the ingest.
 * The shim logs every error to stderr internally before re-raising, so
 * a missed `.catch` at the call site only loses determinism, not
 * observability.
 *
 * Tests want determinism: `await enqueueExpenditureClassify(...)` returns
 * the classifier result once the job completes (or throws on failure).
 * Production code does `void enqueueExpenditureClassify(...).catch(() => {})`
 * to suppress the unhandled-rejection warning while still benefiting
 * from the internal stderr log.
 *
 * @returns a promise that:
 *   - On disabled flag / tenant not allowlisted / empty id list: resolves
 *     immediately with a zero-result (no work performed, no error).
 *   - On a successful run: resolves with the per-row job tally.
 *   - On classifier error: rejects with the underlying error AFTER the
 *     internal stderr log has fired, so callers that `await` see the
 *     real failure mode and callers that `void` it still get the log.
 */
export type EnqueueExpenditureClassifyInput = {
  tenant_id: string;
  expenditure_ids: string[];
};

const ZERO_RESULT: ExpenditureClassifyJobResult = {
  classified: 0,
  skipped_idempotent: 0,
  failed: 0,
  needs_review_downgraded: 0,
};

/**
 * In-flight classify-job registry for test determinism.
 *
 * Production callers do `void enqueueExpenditureClassify(...).catch(...)`
 * — the route's 202 returns before the classifier's INSERT lands. That's
 * the right shape for production (classification is best-effort,
 * downstream of EXPENDITURE_INGESTED) but it produces a race in tests:
 *
 *   1. Test A POSTs to /reclassify; route fires-and-forgets; returns 202.
 *   2. Test A asserts on response, completes.
 *   3. Test B's beforeEach DELETEs `event WHERE kind = 'EXPENDITURE_CLASSIFIED'`.
 *   4. Test A's still-in-flight enqueue *now* INSERTs the EXPENDITURE_CLASSIFIED
 *      row — landing AFTER Test B's cleanup, polluting Test B's assertion.
 *
 * Tests can call `drainPendingClassifyJobs()` in beforeEach (after all
 * Promise.allSettled work) to wait for any in-flight jobs from prior
 * tests to settle BEFORE the cleanup DELETE runs. This converts the
 * fire-and-forget pattern into a deterministic barrier without
 * changing production semantics.
 *
 * Implementation: Set so add/delete are O(1) and order doesn't matter.
 * Each enqueue adds itself, then schedules a `.finally` cleanup that
 * removes itself when the promise settles. The drain helper takes a
 * snapshot of the current Set members and awaits Promise.allSettled —
 * so a transient classifier failure in one pending job doesn't crash
 * the test's beforeEach.
 */
const _pendingJobs: Set<Promise<unknown>> = new Set();

export function enqueueExpenditureClassify(
  input: EnqueueExpenditureClassifyInput,
): Promise<ExpenditureClassifyJobResult> {
  // Fast path: short-circuit before constructing a promise chain. This
  // matches the intent of the gates — when Agent A is disabled (or this
  // tenant isn't in the staged-rollout allowlist), the trigger should be
  // a true no-op with no observable side effects.
  // Gated calls do no DB work and therefore need no drain tracking.
  if (!isAgentEnabled('A')) return Promise.resolve({ ...ZERO_RESULT });
  if (!isTenantAllowed(input.tenant_id)) return Promise.resolve({ ...ZERO_RESULT });
  if (input.expenditure_ids.length === 0) return Promise.resolve({ ...ZERO_RESULT });

  // Future: replace the line below with `pgBoss.send('expenditure-classify',
  // { tenant_id, expenditure_ids })` once pg-boss is bootstrapped. The
  // call shape is intentionally identical — the handler signature already
  // matches the pg-boss job-data contract.
  const job = runExpenditureClassifyJob({
    tenant_id: input.tenant_id,
    expenditure_ids: input.expenditure_ids,
  }).catch((err: unknown) => {
    // Hook errors must NOT propagate up to fail the parent
    // EXPENDITURE_INGESTED insert. The chain transaction has already
    // committed by the time we run; classification is downstream and
    // best-effort. We log enough to triage from CloudWatch (the model
    // and prompt_version are recorded in the OTel span if it got that
    // far — they're not duplicated here).
    console.error(
      '[enqueue-classify] expenditure-classify failed:',
      `tenant=${input.tenant_id}`,
      `ids=${input.expenditure_ids.join(',')}`,
      (err as Error).message,
    );
    // Re-throw so test code that awaits the promise can observe the
    // failure deterministically. Production callers `void` the promise,
    // so the rejection is unhandled-but-observed-by-the-catch above.
    throw err;
  });

  // Register for drain. Use `void` on the .finally chain so the cleanup's
  // own promise (which we don't return) doesn't trigger an unhandled-
  // rejection warning. Note the .finally callback fires regardless of
  // resolve/reject — so we always cleanup.
  _pendingJobs.add(job);
  void job.finally(() => {
    _pendingJobs.delete(job);
  });

  return job;
}

/**
 * Wait for all in-flight `enqueueExpenditureClassify(...)` jobs to
 * settle (resolve OR reject). Test-only — production code should never
 * need this; the fire-and-forget pattern is intentional in production.
 *
 * Use in `beforeEach` (or before assertions that read from `event`,
 * `agent_call_cache`, etc.) to convert the fire-and-forget pattern into
 * a deterministic barrier. Without this, the prior test's still-pending
 * enqueue can land its INSERT after `beforeEach` runs, polluting the
 * current test's preconditions.
 *
 * Snapshot semantics: takes the Set members at call time. New jobs
 * registered AFTER drain starts are NOT awaited (by design — the caller
 * is asking "settle everything in flight now", not "block forever").
 *
 * Uses `Promise.allSettled` so one transient classifier failure
 * doesn't crash the caller. Errors are still logged via the catch
 * handler above; this just means the drain itself never throws.
 */
export async function drainPendingClassifyJobs(): Promise<void> {
  if (_pendingJobs.size === 0) return;
  const snapshot = Array.from(_pendingJobs);
  await Promise.allSettled(snapshot);
}

/** Test-only: number of currently-pending classify jobs. */
export function _pendingClassifyJobsCount(): number {
  return _pendingJobs.size;
}
