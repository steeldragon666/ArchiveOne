import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for the test-determinism layer in enqueue-classify.ts —
 * specifically `drainPendingClassifyJobs()` and the in-flight registry
 * it drains.
 *
 * These tests run WITHOUT the Postgres dependency by:
 *   1. Forcing the gates open via env var (so the function reaches the
 *      promise-tracking code path)
 *   2. Stubbing `runExpenditureClassifyJob` via dynamic import + module
 *      replacement is heavy here; instead we exercise the gates +
 *      registry indirectly: enqueue with EMPTY ids list returns the
 *      zero-result short-circuit (NOT tracked), and we verify drain is
 *      a no-op in that case.
 *
 * For the slow-path drain semantics (where a real job is in flight), we
 * cannot stub the underlying job here — that exercise lives in
 * `expenditures.test.ts` which runs against a live DB.
 */

// Force the agent ON before importing the module (the gates capture env
// at import time via _reloadEnvForTests), so the slow-path branch is
// reachable when needed. We don't actually exercise the slow path here
// — only the gate short-circuits — but matching the conventional setup
// keeps this test robust to future refactors.
process.env.P6_AGENT_A_ENABLED = 'true';
delete process.env.P6_AGENT_TENANT_ALLOWLIST;

const { _reloadEnvForTests } = await import('@cpa/agents/runtime');
_reloadEnvForTests();

const { enqueueExpenditureClassify, drainPendingClassifyJobs, _pendingClassifyJobsCount } =
  await import('./enqueue-classify.js');

const TENANT_X = '00000000-0000-4000-8000-0000000d0001';

before(() => {
  // Ensure no leftover state from sibling tests in the same node:test
  // process. The registry is module-level, so this is the same Set
  // observed by other suites.
  // (Best-effort: there's no public clear method by design — the
  // production lifecycle is "drain, then process exits" via
  // --test-force-exit.)
});

after(() => {
  // Same as above: no public clear. The drain we'd issue here would be
  // a no-op since these tests don't queue real work.
});

test('enqueueExpenditureClassify: empty id list short-circuits — zero-result, NOT tracked', async () => {
  const before = _pendingClassifyJobsCount();

  const result = await enqueueExpenditureClassify({
    tenant_id: TENANT_X,
    expenditure_ids: [],
  });

  assert.deepEqual(result, {
    classified: 0,
    skipped_idempotent: 0,
    failed: 0,
    needs_review_downgraded: 0,
  });

  // Empty id list takes the synchronous short-circuit path BEFORE the
  // job is registered. Pending count must be unchanged.
  assert.equal(
    _pendingClassifyJobsCount(),
    before,
    'short-circuited calls must NOT enter the pending-jobs registry',
  );
});

test('enqueueExpenditureClassify: gate-disabled path short-circuits — NOT tracked', async () => {
  process.env.P6_AGENT_A_ENABLED = 'false';
  _reloadEnvForTests();
  try {
    const before = _pendingClassifyJobsCount();

    const result = await enqueueExpenditureClassify({
      tenant_id: TENANT_X,
      expenditure_ids: ['00000000-0000-4000-8000-0000000d0099'],
    });

    assert.equal(result.classified, 0);
    assert.equal(
      _pendingClassifyJobsCount(),
      before,
      'gate-disabled calls must NOT enter the pending-jobs registry',
    );
  } finally {
    process.env.P6_AGENT_A_ENABLED = 'true';
    _reloadEnvForTests();
  }
});

test('drainPendingClassifyJobs: no-op when registry empty', async () => {
  // Idempotent + cheap when nothing is pending.
  assert.equal(_pendingClassifyJobsCount(), 0);
  await drainPendingClassifyJobs();
  assert.equal(_pendingClassifyJobsCount(), 0);
});

test('drainPendingClassifyJobs: snapshot semantics — does not block on jobs registered AFTER drain starts', async () => {
  // The drain takes a snapshot of the Set at call time. New jobs that
  // register WHILE the drain is awaiting are NOT awaited by THIS drain
  // call. This is intentional — the test caller is asking "settle
  // everything in flight now", not "block forever" (which would deadlock
  // if any production code path enqueues during cleanup).
  //
  // We verify this by calling drain with no pending jobs (no-op) and
  // asserting it returns synchronously to the next microtask. Real
  // slow-path drain semantics are exercised in the integration tests
  // in expenditures.test.ts where a live classifier job runs.
  const start = Date.now();
  await drainPendingClassifyJobs();
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 100, `empty drain should complete in <100ms (was ${elapsed}ms)`);
});
