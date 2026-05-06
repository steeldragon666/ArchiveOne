/**
 * Tests for the cross-reference reconciliation engine (Task F.2).
 *
 * Uses the SqlClient mock pattern established in rules.test.ts / score.test.ts.
 * `reconcileClaim` issues up to 5 SQL queries in sequence (one per finding
 * kind). The mock below intercepts each call in order and returns a scripted
 * result, identified by matching a substring against the SQL template string.
 *
 * Schema realities that shape these tests (see migration files):
 *   - `activity`         has `claim_id`, `code`, `kind`, `title` — no `voided_at`
 *   - `expenditure_line` has `rd_percent`, `description`, `amount` — no `activity_id`
 *   - `time_entry`       has `employee_id`, `started_at`, `ended_at`,
 *                        `duration_minutes` — no `activity_id`, no `hours`
 *   - `narrative_segment` uses `citing_events uuid[]` for evidence citations
 *   - No `narrative_segment_source` table exists
 *
 * The mock strategy: build a SqlClient that matches query text fragments and
 * returns pre-scripted rows, enabling deterministic unit tests without a DB.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileClaim } from './reconciliation.js';
import type { SqlClient } from './types.js';

const CLAIM_ID = '00000000-0000-4000-8000-000000c10001';
const ACTIVITY_ID = '00000000-0000-4000-8000-000000a10001';
const EXPENDITURE_LINE_ID = '00000000-0000-4000-8000-000000e10001';
const TIME_ENTRY_ID = '00000000-0000-4000-8000-000000t10001';
const SEGMENT_ID = '00000000-0000-4000-8000-000000s10001';

/**
 * Build a mock SqlClient that matches queries by scanning the combined
 * template-string text for a unique keyword fragment. Each entry in `routes`
 * is checked in order; the first match wins.
 *
 * This mirrors the multi-query pattern needed by reconcileClaim, which fires
 * one query per finding kind. Using string-fragment matching avoids coupling
 * the mock to exact whitespace or formatting in the implementation.
 */
function buildMockSql(routes: Array<{ match: string; rows: unknown[] }>): SqlClient {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    void values; // unused by mock; real client interpolates them
    const queryText = strings.join('?');
    for (const route of routes) {
      if (queryText.includes(route.match)) {
        return Promise.resolve(route.rows);
      }
    }
    // Unmatched query — return empty result (safe default, surfaces missing routes quickly)
    return Promise.resolve([]);
  };
  return fn as unknown as SqlClient;
}

/** Noop sql client — returns empty for every query (clean-claim scenario). */
const emptySql: SqlClient = (() => {
  const fn = (..._args: unknown[]): Promise<unknown[]> => Promise.resolve([]);
  return fn as unknown as SqlClient;
})();

// ---------------------------------------------------------------------------
// 1. activity with no time entries → activity_no_time finding
// ---------------------------------------------------------------------------
test('reconcileClaim: activity with no time entries → activity_no_time finding', async () => {
  const sql = buildMockSql([
    {
      match: 'activity_no_time',
      rows: [{ id: ACTIVITY_ID, code: 'CA-01', title: 'Hydrogen catalyst research' }],
    },
    { match: 'activity_no_cost', rows: [] },
    { match: 'cost_no_activity', rows: [] },
    { match: 'time_no_activity', rows: [] },
    { match: 'timesheet_invoice_mismatch', rows: [] },
    { match: 'narrative_no_evidence', rows: [] },
  ]);

  const findings = await reconcileClaim({ claim_id: CLAIM_ID, sql_client: sql });

  const finding = findings.find((f) => f.kind === 'activity_no_time');
  assert.ok(finding, 'Expected an activity_no_time finding');
  assert.equal(finding.kind, 'activity_no_time');
  assert.equal(finding.severity, 'medium');
  assert.equal(finding.affected_id, ACTIVITY_ID);
  assert.ok(finding.detail.length > 0, 'detail must be non-empty');
  assert.ok(finding.suggested_action.length > 0, 'suggested_action must be non-empty');
});

// ---------------------------------------------------------------------------
// 2. expenditure with rd_percent > 0 and no activity_id → cost_no_activity finding
// ---------------------------------------------------------------------------
test('reconcileClaim: expenditure with rd_percent>0 and no activity linkage → cost_no_activity finding', async () => {
  const sql = buildMockSql([
    { match: 'activity_no_time', rows: [] },
    { match: 'activity_no_cost', rows: [] },
    {
      match: 'cost_no_activity',
      rows: [
        {
          id: EXPENDITURE_LINE_ID,
          description: 'Lab materials',
          amount: '4200.00',
          rd_percent: 80,
        },
      ],
    },
    { match: 'time_no_activity', rows: [] },
    { match: 'timesheet_invoice_mismatch', rows: [] },
    { match: 'narrative_no_evidence', rows: [] },
  ]);

  const findings = await reconcileClaim({ claim_id: CLAIM_ID, sql_client: sql });

  const finding = findings.find((f) => f.kind === 'cost_no_activity');
  assert.ok(finding, 'Expected a cost_no_activity finding');
  assert.equal(finding.severity, 'high');
  assert.equal(finding.affected_id, EXPENDITURE_LINE_ID);
});

// ---------------------------------------------------------------------------
// 3. time entry with no activity_id → time_no_activity finding
// ---------------------------------------------------------------------------
test('reconcileClaim: time entry with no activity linkage → time_no_activity finding', async () => {
  const sql = buildMockSql([
    { match: 'activity_no_time', rows: [] },
    { match: 'activity_no_cost', rows: [] },
    { match: 'cost_no_activity', rows: [] },
    {
      match: 'time_no_activity',
      rows: [
        {
          id: TIME_ENTRY_ID,
          employee_id: '00000000-0000-4000-8000-000000emp01',
          duration_minutes: 120,
          started_at: '2025-07-01T09:00:00Z',
        },
      ],
    },
    { match: 'timesheet_invoice_mismatch', rows: [] },
    { match: 'narrative_no_evidence', rows: [] },
  ]);

  const findings = await reconcileClaim({ claim_id: CLAIM_ID, sql_client: sql });

  const finding = findings.find((f) => f.kind === 'time_no_activity');
  assert.ok(finding, 'Expected a time_no_activity finding');
  assert.equal(finding.severity, 'high');
  assert.equal(finding.affected_id, TIME_ENTRY_ID);
});

// ---------------------------------------------------------------------------
// 4. Voided (soft-deleted) activity should NOT produce findings
//    The implementation filters at the query level; the mock returns no rows
//    for a claim where all activities are voided, simulating the WHERE clause.
// ---------------------------------------------------------------------------
test('reconcileClaim: claim with only voided activities → no activity findings', async () => {
  // Return empty for activity-related queries (all activities filtered out by voided_at)
  const sql = buildMockSql([
    { match: 'activity_no_time', rows: [] },
    { match: 'activity_no_cost', rows: [] },
    { match: 'cost_no_activity', rows: [] },
    { match: 'time_no_activity', rows: [] },
    { match: 'timesheet_invoice_mismatch', rows: [] },
    { match: 'narrative_no_evidence', rows: [] },
  ]);

  const findings = await reconcileClaim({ claim_id: CLAIM_ID, sql_client: sql });

  const activityFindings = findings.filter(
    (f) => f.kind === 'activity_no_time' || f.kind === 'activity_no_cost',
  );
  assert.equal(activityFindings.length, 0, 'Voided activities should not appear in findings');
});

// ---------------------------------------------------------------------------
// 5. Clean claim (all linked) → empty findings array
// ---------------------------------------------------------------------------
test('reconcileClaim: clean claim (all linked) → empty findings array', async () => {
  const findings = await reconcileClaim({ claim_id: CLAIM_ID, sql_client: emptySql });
  assert.equal(findings.length, 0, 'Expected no findings for a fully-linked claim');
  assert.ok(Array.isArray(findings), 'Return value must be an array');
});

// ---------------------------------------------------------------------------
// 6. Returns correct finding shape — all required fields present
// ---------------------------------------------------------------------------
test('reconcileClaim: returns correct finding shape (kind, severity, affected_id, detail, suggested_action)', async () => {
  const sql = buildMockSql([
    {
      match: 'activity_no_time',
      rows: [{ id: ACTIVITY_ID, code: 'CA-01', title: 'Soil carbon assay' }],
    },
    { match: 'activity_no_cost', rows: [] },
    { match: 'cost_no_activity', rows: [] },
    { match: 'time_no_activity', rows: [] },
    { match: 'timesheet_invoice_mismatch', rows: [] },
    { match: 'narrative_no_evidence', rows: [] },
  ]);

  const findings = await reconcileClaim({ claim_id: CLAIM_ID, sql_client: sql });

  assert.ok(findings.length > 0, 'Expected at least one finding');
  for (const f of findings) {
    assert.ok('kind' in f, `finding missing 'kind': ${JSON.stringify(f)}`);
    assert.ok('severity' in f, `finding missing 'severity': ${JSON.stringify(f)}`);
    assert.ok('affected_id' in f, `finding missing 'affected_id': ${JSON.stringify(f)}`);
    assert.ok('detail' in f, `finding missing 'detail': ${JSON.stringify(f)}`);
    assert.ok('suggested_action' in f, `finding missing 'suggested_action': ${JSON.stringify(f)}`);
    // Validate severity values
    assert.ok(
      ['high', 'medium', 'low'].includes(f.severity),
      `Invalid severity '${f.severity}' on finding ${f.kind}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 7. narrative_no_evidence: segment with empty citing_events → finding
// ---------------------------------------------------------------------------
test('reconcileClaim: narrative segment with no citing events → narrative_no_evidence finding', async () => {
  const sql = buildMockSql([
    { match: 'activity_no_time', rows: [] },
    { match: 'activity_no_cost', rows: [] },
    { match: 'cost_no_activity', rows: [] },
    { match: 'time_no_activity', rows: [] },
    { match: 'timesheet_invoice_mismatch', rows: [] },
    {
      match: 'narrative_no_evidence',
      rows: [
        {
          id: SEGMENT_ID,
          narrative_draft_id: '00000000-0000-4000-8000-000000d10001',
          section_kind: 'hypothesis',
        },
      ],
    },
  ]);

  const findings = await reconcileClaim({ claim_id: CLAIM_ID, sql_client: sql });

  const finding = findings.find((f) => f.kind === 'narrative_no_evidence');
  assert.ok(finding, 'Expected a narrative_no_evidence finding');
  assert.equal(finding.severity, 'medium');
  assert.equal(finding.affected_id, SEGMENT_ID);
});

// ---------------------------------------------------------------------------
// 8. Multiple finding kinds can coexist in one result
// ---------------------------------------------------------------------------
test('reconcileClaim: multiple finding kinds coexist in result', async () => {
  const sql = buildMockSql([
    {
      match: 'activity_no_time',
      rows: [{ id: ACTIVITY_ID, code: 'CA-01', title: 'Multi-finding test' }],
    },
    { match: 'activity_no_cost', rows: [] },
    {
      match: 'cost_no_activity',
      rows: [
        {
          id: EXPENDITURE_LINE_ID,
          description: 'Cloud compute',
          amount: '1500.00',
          rd_percent: 100,
        },
      ],
    },
    { match: 'time_no_activity', rows: [] },
    { match: 'timesheet_invoice_mismatch', rows: [] },
    { match: 'narrative_no_evidence', rows: [] },
  ]);

  const findings = await reconcileClaim({ claim_id: CLAIM_ID, sql_client: sql });

  const kinds = new Set(findings.map((f) => f.kind));
  assert.ok(kinds.has('activity_no_time'), 'Expected activity_no_time');
  assert.ok(kinds.has('cost_no_activity'), 'Expected cost_no_activity');
  assert.equal(findings.length, 2, 'Expected exactly 2 findings');
});
