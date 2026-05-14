/**
 * Stress tests for the document-extract worker.
 *
 * Goal: hammer the worker with high-concurrency loads that exercise the
 * places real production traffic breaks:
 *   - DB connection pool exhaustion (we cap at DATABASE_POOL_MAX, the
 *     worker holds connections during the analyzer call)
 *   - Race conditions in the chain-event Step 6 (prev_hash lookup +
 *     INSERT happen in two statements; the advisory lock isn't held)
 *   - Idempotency of re-runs (workers can deliver-twice; the 'complete'
 *     short-circuit must hold)
 *   - Ledger integrity (every successful call -> exactly one row; sum
 *     must equal the sum of individual recorded cost_aud_cents)
 *
 * Strategy: rotate through the synthetic fixture corpus N times,
 * dispatch all events concurrently, then assert on the invariants. We
 * use the MockDocumentAnalyzer so this stress test runs in seconds
 * instead of minutes and doesn't burn real Anthropic tokens.
 *
 * These tests live in a separate file from document-extract.test.ts
 * so they can be run / skipped independently — they're heavier (~30s
 * each) and use more DB resources.
 */
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { privilegedSql, sql } from '@cpa/db/client';
import { SYNTHETIC_FIXTURES, SYNTHETIC_FIXTURES_HAPPY_PATH } from '@cpa/agents';

process.env.DOCUMENT_ANALYZER_IMPL = 'mock';

const { runDocumentExtractJob } = await import('./document-extract.js');

// Pinned UUIDs ('ds01' = "document-stress 01")
const TENANT = '00000000-0000-4000-8000-000000d50001';
const ADMIN_USER = '00000000-0000-4000-8000-000000d50010';
const SUBJECT = '00000000-0000-4000-8000-000000d50020';
const PROJECT = '00000000-0000-4000-8000-000000d50030';
const CLAIM = '00000000-0000-4000-8000-000000d50040';

const cleanup = async (): Promise<void> => {
  await privilegedSql`DELETE FROM llm_token_usage WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM event WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM claim WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM project WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM subject_tenant WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT}`;
  await sql`DELETE FROM "user" WHERE id = ${ADMIN_USER}`;
  await sql`DELETE FROM tenant WHERE id = ${TENANT}`;
};

before(async () => {
  await cleanup();

  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT}, 'Stress Test Firm', 'stress-test', 'mixed')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${ADMIN_USER}, 'stress-admin@example.com', 'microsoft', 'microsoft:stress-admin', 'Stress Admin')`;
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT}, ${ADMIN_USER}, 'admin', true)`;
  await privilegedSql`INSERT INTO subject_tenant (id, tenant_id, name, kind)
                       VALUES (${SUBJECT}, ${TENANT}, 'Stress claimant', 'claimant')`;
  await privilegedSql`INSERT INTO project (id, tenant_id, subject_tenant_id, name, started_at)
                       VALUES (${PROJECT}, ${TENANT}, ${SUBJECT}, 'Stress project', '2025-07-01T00:00:00Z')`;
  await privilegedSql`INSERT INTO claim (id, tenant_id, subject_tenant_id, project_id, fiscal_year, stage)
                       VALUES (${CLAIM}, ${TENANT}, ${SUBJECT}, ${PROJECT}, 2026, 'engagement')`;
});

beforeEach(async () => {
  await privilegedSql`DELETE FROM llm_token_usage WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM event WHERE tenant_id = ${TENANT}`;
});

after(async () => {
  await cleanup();
  await sql.end();
  await privilegedSql.end();
});

// ---------------------------------------------------------------------------
// Helper: seed an event quickly. Reuses the same INSERT shape the
// integration test uses, just inline so this file is self-contained.
// ---------------------------------------------------------------------------

async function seedEvent(rawText: string): Promise<string> {
  const id = randomUUID();
  const payload = { _v: 1, source: 'stress', raw_text: rawText };
  const hash = createHash('sha256').update(id).digest('hex');
  await privilegedSql`
    INSERT INTO event (
      id, tenant_id, subject_tenant_id, kind, payload,
      classification, prev_hash, hash, idempotency_key,
      captured_at, received_at, captured_by_user_id, extraction_status
    ) VALUES (
      ${id}::uuid, ${TENANT}::uuid, ${SUBJECT}::uuid, 'SUPPORTING',
      ${privilegedSql.json(payload)},
      NULL, NULL, ${hash}, NULL, NOW(), NOW(),
      ${ADMIN_USER}::uuid, 'pending'
    )
  `;
  return id;
}

// ---------------------------------------------------------------------------
// Stress test 1: 30 concurrent extractions, no edge cases
// ---------------------------------------------------------------------------

test('STRESS: 30 concurrent extractions complete and ledger every call exactly once', async () => {
  const N = 30;
  // Rotate through the happy-path fixtures so we have varied content
  // but a deterministic event count.
  const fixturesToRun = Array.from({ length: N }, (_, i) => {
    return SYNTHETIC_FIXTURES_HAPPY_PATH[i % SYNTHETIC_FIXTURES_HAPPY_PATH.length]!;
  });

  // Seed all events first, sequentially, so the bottleneck during the
  // stress phase is the worker not the seeder.
  const eventIds: string[] = [];
  for (const fx of fixturesToRun) {
    eventIds.push(await seedEvent(fx.raw_text));
  }
  assert.equal(eventIds.length, N);

  // Now fire all workers in parallel.
  const t0 = Date.now();
  await Promise.all(
    eventIds.map((eventId) =>
      runDocumentExtractJob({
        event_id: eventId,
        tenant_id: TENANT,
        subject_tenant_id: SUBJECT,
      }),
    ),
  );
  const elapsedMs = Date.now() - t0;
  console.log(`[STRESS] ${N} concurrent extractions completed in ${elapsedMs}ms`);

  // Every event should be 'complete'.
  const stuck = await privilegedSql<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM event
     WHERE tenant_id = ${TENANT}
       AND extraction_status != 'complete'
  `;
  assert.equal(stuck[0]!.n, '0', `expected 0 stuck events, found ${stuck[0]!.n}`);

  // Exactly one ledger row per extraction.
  const ledger = await privilegedSql<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM llm_token_usage WHERE tenant_id = ${TENANT}
  `;
  assert.equal(parseInt(ledger[0]!.n, 10), N);
});

// ---------------------------------------------------------------------------
// Stress test 2: 60 concurrent extractions mixing happy-path + edge cases
// ---------------------------------------------------------------------------

test('STRESS: 60 mixed extractions (incl. edge cases) all reach terminal status', async () => {
  const N = 60;
  // Cycle through the FULL corpus including edge cases (malformed,
  // under-50-char, oversized). Worker must handle each one without
  // crashing or leaving an event 'pending'.
  const fixturesToRun = Array.from({ length: N }, (_, i) => {
    return SYNTHETIC_FIXTURES[i % SYNTHETIC_FIXTURES.length]!;
  });

  const eventIds: string[] = [];
  for (const fx of fixturesToRun) {
    eventIds.push(await seedEvent(fx.raw_text));
  }

  const t0 = Date.now();
  await Promise.all(
    eventIds.map((eventId) =>
      runDocumentExtractJob({
        event_id: eventId,
        tenant_id: TENANT,
        subject_tenant_id: SUBJECT,
      }),
    ),
  );
  console.log(`[STRESS] ${N} mixed extractions completed in ${Date.now() - t0}ms`);

  // Distribution: every event in 'complete' OR 'failed'. Specifically
  // ZERO in 'pending' (would indicate a worker crash mid-flight).
  const byStatus = await privilegedSql<{ extraction_status: string; n: string }[]>`
    SELECT extraction_status, COUNT(*)::text AS n
      FROM event
     WHERE tenant_id = ${TENANT}
     GROUP BY extraction_status
  `;
  const statusMap = Object.fromEntries(
    byStatus.map((r) => [r.extraction_status, parseInt(r.n, 10)]),
  );
  console.log('[STRESS] status distribution:', statusMap);
  assert.equal(statusMap.pending ?? 0, 0, 'STUCK events found');
  const totalTerminal = (statusMap.complete ?? 0) + (statusMap.failed ?? 0);
  assert.equal(totalTerminal, N);
});

// ---------------------------------------------------------------------------
// Stress test 3: ledger integrity — sum matches per-row sum
// ---------------------------------------------------------------------------

test('STRESS: ledger sum invariant holds across 20 concurrent extractions', async () => {
  const N = 20;
  const eventIds: string[] = [];
  for (let i = 0; i < N; i += 1) {
    const fx = SYNTHETIC_FIXTURES_HAPPY_PATH[i % SYNTHETIC_FIXTURES_HAPPY_PATH.length]!;
    eventIds.push(await seedEvent(fx.raw_text));
  }
  await Promise.all(
    eventIds.map((eventId) =>
      runDocumentExtractJob({
        event_id: eventId,
        tenant_id: TENANT,
        subject_tenant_id: SUBJECT,
      }),
    ),
  );
  // Two paths to the same number:
  //   (a) SUM(cost_aud_cents) computed by the DB
  //   (b) sum of per-row values fetched then summed in JS
  // They must agree exactly. Disagreement would imply
  // partial-row visibility (impossible under MVCC for committed rows
  // but worth pinning as an invariant — also catches future bugs
  // where someone tries to UPDATE cost_aud_cents post-hoc).
  const aggRows = await privilegedSql<{ total: string }[]>`
    SELECT COALESCE(SUM(cost_aud_cents), 0)::text AS total
      FROM llm_token_usage WHERE tenant_id = ${TENANT}
  `;
  const individualRows = await privilegedSql<{ cost_aud_cents: number }[]>`
    SELECT cost_aud_cents FROM llm_token_usage WHERE tenant_id = ${TENANT}
  `;
  const dbSum = parseInt(aggRows[0]!.total, 10);
  const jsSum = individualRows.reduce((acc, r) => acc + r.cost_aud_cents, 0);
  assert.equal(dbSum, jsSum, `DB sum ${dbSum} != JS sum ${jsSum}`);
  assert.equal(individualRows.length, N);
});

// ---------------------------------------------------------------------------
// Stress test 4: re-run idempotency under concurrency
// ---------------------------------------------------------------------------

test('STRESS: re-running the same N events concurrently produces no extra ledger rows', async () => {
  const N = 15;
  const eventIds: string[] = [];
  for (let i = 0; i < N; i += 1) {
    const fx = SYNTHETIC_FIXTURES_HAPPY_PATH[i % SYNTHETIC_FIXTURES_HAPPY_PATH.length]!;
    eventIds.push(await seedEvent(fx.raw_text));
  }
  // First pass — all events go from pending -> complete + write ledger.
  await Promise.all(
    eventIds.map((eventId) =>
      runDocumentExtractJob({
        event_id: eventId,
        tenant_id: TENANT,
        subject_tenant_id: SUBJECT,
      }),
    ),
  );
  const firstLedger = await privilegedSql<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM llm_token_usage WHERE tenant_id = ${TENANT}
  `;
  assert.equal(parseInt(firstLedger[0]!.n, 10), N);

  // Second pass — every event is already 'complete' so the worker
  // short-circuits. Ledger count must NOT grow.
  await Promise.all(
    eventIds.map((eventId) =>
      runDocumentExtractJob({
        event_id: eventId,
        tenant_id: TENANT,
        subject_tenant_id: SUBJECT,
      }),
    ),
  );
  const secondLedger = await privilegedSql<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM llm_token_usage WHERE tenant_id = ${TENANT}
  `;
  assert.equal(
    parseInt(secondLedger[0]!.n, 10),
    N,
    'second pass leaked extra ledger rows — re-run idempotency broken',
  );

  // Triple-pass for paranoid measure.
  await Promise.all(
    eventIds.map((eventId) =>
      runDocumentExtractJob({
        event_id: eventId,
        tenant_id: TENANT,
        subject_tenant_id: SUBJECT,
      }),
    ),
  );
  const thirdLedger = await privilegedSql<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM llm_token_usage WHERE tenant_id = ${TENANT}
  `;
  assert.equal(parseInt(thirdLedger[0]!.n, 10), N);
});

// ---------------------------------------------------------------------------
// Stress test 5: same event_id concurrent dispatch (worker delivers
// duplicate jobs at-least-once) — only ONE ledger row should land
// ---------------------------------------------------------------------------

test('STRESS: 10x concurrent invocations of the SAME event_id produce exactly 1 ledger row', async () => {
  const fx = SYNTHETIC_FIXTURES_HAPPY_PATH[0]!;
  const eventId = await seedEvent(fx.raw_text);

  // 10 simultaneous invocations of the same job (simulates pg-boss
  // at-least-once delivery during a retry storm). The advisory-lock
  // claim-pattern in runDocumentExtractJob Step 0 should serialize
  // these so only ONE worker actually runs the analyzer + ledger
  // insert; the other 9 see status='processing' or 'complete' and
  // short-circuit.
  await Promise.all(
    Array.from({ length: 10 }, () =>
      runDocumentExtractJob({
        event_id: eventId,
        tenant_id: TENANT,
        subject_tenant_id: SUBJECT,
      }),
    ),
  );

  const ledger = await privilegedSql<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM llm_token_usage WHERE tenant_id = ${TENANT}
  `;
  const rowCount = parseInt(ledger[0]!.n, 10);
  assert.equal(
    rowCount,
    1,
    `expected exactly 1 ledger row from 10x concurrent same-event dispatch; got ${rowCount} — advisory lock regression`,
  );

  // And the event ends in 'complete' (not stuck in 'processing').
  const evStatus = await privilegedSql<{ extraction_status: string }[]>`
    SELECT extraction_status FROM event WHERE id = ${eventId}
  `;
  assert.equal(evStatus[0]!.extraction_status, 'complete');
});
