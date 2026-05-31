import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFinalisationGates, type FinalisationViolation } from './finalisation-gates.js';
import type { SqlClient } from './workflow.js';

/**
 * Pure unit tests for the finalisation gate matrix. The function is a
 * thin SELECT + projection, so a mocked SqlClient that returns the
 * activity-row fixture is enough to pin every branch.
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

function mockSql(rows: ActivityFixture[]): SqlClient {
  const fn = (() => Promise.resolve(rows)) as unknown as SqlClient;
  return fn;
}

test('evaluateFinalisationGates: empty claim returns ok=true', async () => {
  const result = await evaluateFinalisationGates(mockSql([]), 'claim-uuid');
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
});

test('evaluateFinalisationGates: clean activities return ok=true', async () => {
  const result = await evaluateFinalisationGates(
    mockSql([
      {
        id: 'a-1',
        code: 'CA-001',
        kind: 'core',
        performed_overseas: false,
        overseas_findings_obtained: false,
        supports_activity_id: null,
        hypothesis_formed_at: new Date(),
      },
      {
        id: 'a-2',
        code: 'SA-001',
        kind: 'supporting',
        performed_overseas: false,
        overseas_findings_obtained: false,
        supports_activity_id: 'a-1',
        hypothesis_formed_at: new Date(),
      },
    ]),
    'claim-uuid',
  );
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
});

test('evaluateFinalisationGates: overseas activity without findings blocks', async () => {
  const result = await evaluateFinalisationGates(
    mockSql([
      {
        id: 'a-1',
        code: 'CA-001',
        kind: 'core',
        performed_overseas: true,
        overseas_findings_obtained: false,
        supports_activity_id: null,
        hypothesis_formed_at: new Date(),
      },
    ]),
    'claim-uuid',
  );
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  const v = result.violations[0] as FinalisationViolation;
  assert.equal(v.kind, 'overseas_findings_missing');
  assert.equal(v.severity, 'block');
  assert.equal(v.activity_code, 'CA-001');
  assert.match(v.message, /Overseas Findings/i);
  assert.match(v.statutory, /TA 2023\/5/i);
});

test('evaluateFinalisationGates: overseas activity WITH findings is fine', async () => {
  const result = await evaluateFinalisationGates(
    mockSql([
      {
        id: 'a-1',
        code: 'CA-001',
        kind: 'core',
        performed_overseas: true,
        overseas_findings_obtained: true,
        supports_activity_id: null,
        hypothesis_formed_at: new Date(),
      },
    ]),
    'claim-uuid',
  );
  assert.equal(result.ok, true);
});

test('evaluateFinalisationGates: supporting without parent FK blocks', async () => {
  const result = await evaluateFinalisationGates(
    mockSql([
      {
        id: 'a-2',
        code: 'SA-001',
        kind: 'supporting',
        performed_overseas: false,
        overseas_findings_obtained: false,
        supports_activity_id: null,
        hypothesis_formed_at: new Date(),
      },
    ]),
    'claim-uuid',
  );
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  const v = result.violations[0] as FinalisationViolation;
  assert.equal(v.kind, 'supporting_missing_parent');
  assert.equal(v.activity_code, 'SA-001');
  assert.match(v.statutory, /s\.355-30/i);
});

test('evaluateFinalisationGates: hypothesis_formed_at NULL blocks', async () => {
  const result = await evaluateFinalisationGates(
    mockSql([
      {
        id: 'a-1',
        code: 'CA-001',
        kind: 'core',
        performed_overseas: false,
        overseas_findings_obtained: false,
        supports_activity_id: null,
        hypothesis_formed_at: null,
      },
    ]),
    'claim-uuid',
  );
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  const v = result.violations[0] as FinalisationViolation;
  assert.equal(v.kind, 'hypothesis_formed_at_missing');
  assert.match(v.statutory, /Body-by-Michael/i);
});

test('evaluateFinalisationGates: multiple violations across activities accumulate', async () => {
  const result = await evaluateFinalisationGates(
    mockSql([
      {
        id: 'a-1',
        code: 'CA-001',
        kind: 'core',
        performed_overseas: true,
        overseas_findings_obtained: false,
        supports_activity_id: null,
        hypothesis_formed_at: null,
      },
      {
        id: 'a-2',
        code: 'SA-001',
        kind: 'supporting',
        performed_overseas: false,
        overseas_findings_obtained: false,
        supports_activity_id: null,
        hypothesis_formed_at: new Date(),
      },
    ]),
    'claim-uuid',
  );
  assert.equal(result.ok, false);
  // CA-001 trips overseas + hypothesis; SA-001 trips parent-missing = 3 total.
  assert.equal(result.violations.length, 3);
  const kinds = result.violations.map((v) => v.kind).sort();
  assert.deepEqual(kinds, [
    'hypothesis_formed_at_missing',
    'overseas_findings_missing',
    'supporting_missing_parent',
  ]);
});
