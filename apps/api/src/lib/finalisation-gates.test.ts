import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFinalisationGates, type FinalisationViolation } from './finalisation-gates.js';
import type { SqlClient } from './workflow.js';

/**
 * Pure unit tests for the finalisation gate matrix. The function runs
 * two SELECTs (activities, then claim+subject_tenant); the mock below
 * answers them in order based on a queue.
 */

interface ActivityFixture {
  id: string;
  code: string;
  kind: 'core' | 'supporting';
  performed_overseas: boolean;
  overseas_findings_obtained: boolean;
  supports_activity_id: string | null;
  hypothesis_formed_at: Date | string | null;
}

interface SubjectFixture {
  fiscal_year: number;
  subject_tenant_id: string;
  subject_name: string;
  entity_kind: 'standalone' | 'head_company' | 'r_and_d_entity' | 'associate_entity';
  head_company_id: string | null;
  aggregated_turnover_aud: string | null;
  aggregated_turnover_fy_label: string | null;
  head_entity_kind: 'standalone' | 'head_company' | 'r_and_d_entity' | 'associate_entity' | null;
}

/**
 * Build a mock SqlClient that returns activities on call 1 and subject
 * row(s) on call 2. Pass `subject: null` to simulate "claim not found"
 * (no subject row joins to it), in which case the entity-level checks
 * are skipped entirely.
 */
function mockSql(activities: ActivityFixture[], subject: SubjectFixture | null): SqlClient {
  const queue: unknown[][] = [activities, subject === null ? [] : [subject]];
  return (() => Promise.resolve(queue.shift() ?? [])) as unknown as SqlClient;
}

const standalone = (over: Partial<SubjectFixture> = {}): SubjectFixture => ({
  fiscal_year: 2026,
  subject_tenant_id: 's-1',
  subject_name: 'Acme Pty Ltd',
  entity_kind: 'standalone',
  head_company_id: null,
  aggregated_turnover_aud: null,
  aggregated_turnover_fy_label: null,
  head_entity_kind: null,
  ...over,
});

// ---------------------------------------------------------------------
// v1 rules (activities) — still pass after the v2 extension
// ---------------------------------------------------------------------

test('v1: empty claim + standalone subject returns ok=true', async () => {
  const result = await evaluateFinalisationGates(mockSql([], standalone()), 'claim-uuid');
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
});

test('v1: overseas activity without findings still blocks', async () => {
  const result = await evaluateFinalisationGates(
    mockSql(
      [
        {
          id: 'a-1',
          code: 'CA-001',
          kind: 'core',
          performed_overseas: true,
          overseas_findings_obtained: false,
          supports_activity_id: null,
          hypothesis_formed_at: new Date(),
        },
      ],
      standalone(),
    ),
    'claim-uuid',
  );
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0]?.kind, 'overseas_findings_missing');
});

test('v1: supporting without parent FK still blocks', async () => {
  const result = await evaluateFinalisationGates(
    mockSql(
      [
        {
          id: 'a-2',
          code: 'SA-001',
          kind: 'supporting',
          performed_overseas: false,
          overseas_findings_obtained: false,
          supports_activity_id: null,
          hypothesis_formed_at: new Date(),
        },
      ],
      standalone(),
    ),
    'claim-uuid',
  );
  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.kind, 'supporting_missing_parent');
});

test('v1: hypothesis_formed_at NULL still blocks', async () => {
  const result = await evaluateFinalisationGates(
    mockSql(
      [
        {
          id: 'a-1',
          code: 'CA-001',
          kind: 'core',
          performed_overseas: false,
          overseas_findings_obtained: false,
          supports_activity_id: null,
          hypothesis_formed_at: null,
        },
      ],
      standalone(),
    ),
    'claim-uuid',
  );
  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.kind, 'hypothesis_formed_at_missing');
});

// ---------------------------------------------------------------------
// v2 rules — head_company turnover (s.328-115)
// ---------------------------------------------------------------------

test('v2: head_company with turnover for matching FY passes', async () => {
  const result = await evaluateFinalisationGates(
    mockSql(
      [],
      standalone({
        entity_kind: 'head_company',
        aggregated_turnover_aud: '15000000.00',
        aggregated_turnover_fy_label: 'FY26',
      }),
    ),
    'claim-uuid',
  );
  assert.equal(result.ok, true);
});

test('v2: head_company missing aggregated_turnover blocks', async () => {
  const result = await evaluateFinalisationGates(
    mockSql(
      [],
      standalone({
        entity_kind: 'head_company',
        aggregated_turnover_aud: null,
        aggregated_turnover_fy_label: null,
      }),
    ),
    'claim-uuid',
  );
  assert.equal(result.ok, false);
  const v = result.violations[0] as FinalisationViolation;
  assert.equal(v.kind, 'head_company_turnover_missing');
  assert.equal(v.severity, 'block');
  assert.equal(v.activity_id, null);
  assert.match(v.message, /aggregated_turnover_aud/);
  assert.match(v.message, /FY26/);
  assert.match(v.statutory, /s\.328-115/);
});

test('v2: head_company with turnover for WRONG FY blocks', async () => {
  // Captured FY25 turnover but the claim is FY26 — needs a fresh number.
  const result = await evaluateFinalisationGates(
    mockSql(
      [],
      standalone({
        entity_kind: 'head_company',
        aggregated_turnover_aud: '12000000.00',
        aggregated_turnover_fy_label: 'FY25',
      }),
    ),
    'claim-uuid',
  );
  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.kind, 'head_company_turnover_missing');
});

// ---------------------------------------------------------------------
// v2 rules — subsidiary group integrity
// ---------------------------------------------------------------------

test('v2: r_and_d_entity with valid head_company passes', async () => {
  const result = await evaluateFinalisationGates(
    mockSql(
      [],
      standalone({
        entity_kind: 'r_and_d_entity',
        head_company_id: 's-head',
        head_entity_kind: 'head_company',
      }),
    ),
    'claim-uuid',
  );
  assert.equal(result.ok, true);
});

test('v2: r_and_d_entity with NULL head_company_id blocks', async () => {
  const result = await evaluateFinalisationGates(
    mockSql(
      [],
      standalone({
        entity_kind: 'r_and_d_entity',
        head_company_id: null,
        head_entity_kind: null,
      }),
    ),
    'claim-uuid',
  );
  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.kind, 'subsidiary_missing_head_company');
  assert.match(result.violations[0]?.message ?? '', /head_company_id/);
});

test('v2: associate_entity pointing at a non-head row blocks', async () => {
  // The head_company_id points at another r_and_d_entity (group set up
  // incorrectly — the operator chained subsidiaries instead of pointing
  // them at the top).
  const result = await evaluateFinalisationGates(
    mockSql(
      [],
      standalone({
        entity_kind: 'associate_entity',
        head_company_id: 's-wrong',
        head_entity_kind: 'r_and_d_entity',
      }),
    ),
    'claim-uuid',
  );
  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.kind, 'subsidiary_missing_head_company');
  assert.match(result.violations[0]?.message ?? '', /doesn't point at a head_company/);
});

test('v2: standalone entity_kind is exempt from v2 checks', async () => {
  // No turnover, no head_company — but standalone entities don't trigger
  // either rule.
  const result = await evaluateFinalisationGates(mockSql([], standalone()), 'claim-uuid');
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------
// Combined v1 + v2 violations accumulate
// ---------------------------------------------------------------------

test('v1+v2 combined: activity + entity violations accumulate', async () => {
  const result = await evaluateFinalisationGates(
    mockSql(
      [
        {
          id: 'a-1',
          code: 'CA-001',
          kind: 'core',
          performed_overseas: true,
          overseas_findings_obtained: false,
          supports_activity_id: null,
          hypothesis_formed_at: null,
        },
      ],
      standalone({
        entity_kind: 'head_company',
        aggregated_turnover_aud: null,
      }),
    ),
    'claim-uuid',
  );
  assert.equal(result.ok, false);
  // CA-001 trips overseas + hypothesis = 2; head_company turnover = 1; total 3.
  assert.equal(result.violations.length, 3);
  const kinds = result.violations.map((v) => v.kind).sort();
  assert.deepEqual(kinds, [
    'head_company_turnover_missing',
    'hypothesis_formed_at_missing',
    'overseas_findings_missing',
  ]);
});
