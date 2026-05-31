import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGGREGATED_TURNOVER_THRESHOLD_AUD,
  ENTITY_KINDS_LITERAL,
  OFFSET_RATE_LARGE,
  OFFSET_RATE_SMALL,
  entityKind,
  offsetRateForAggregatedTurnover,
  subjectTenant,
} from './subject-tenant.js';

test('entityKind: all 4 values parse', () => {
  for (const k of ENTITY_KINDS_LITERAL) {
    assert.equal(entityKind.parse(k), k);
  }
});

test('offsetRateForAggregatedTurnover: < $20M → 43.5% small-entity rate', () => {
  assert.equal(offsetRateForAggregatedTurnover('19999999.99'), OFFSET_RATE_SMALL);
  assert.equal(offsetRateForAggregatedTurnover('1000000.00'), OFFSET_RATE_SMALL);
  assert.equal(offsetRateForAggregatedTurnover('0.00'), OFFSET_RATE_SMALL);
});

test('offsetRateForAggregatedTurnover: >= $20M → 38.5% large-entity rate', () => {
  assert.equal(
    offsetRateForAggregatedTurnover(String(AGGREGATED_TURNOVER_THRESHOLD_AUD) + '.00'),
    OFFSET_RATE_LARGE,
  );
  assert.equal(offsetRateForAggregatedTurnover('25000000.00'), OFFSET_RATE_LARGE);
});

test('offsetRateForAggregatedTurnover: null / undefined / empty → null', () => {
  assert.equal(offsetRateForAggregatedTurnover(null), null);
  assert.equal(offsetRateForAggregatedTurnover(undefined), null);
  assert.equal(offsetRateForAggregatedTurnover(''), null);
});

test('offsetRateForAggregatedTurnover: NaN-producing input → null', () => {
  assert.equal(offsetRateForAggregatedTurnover('not-a-number'), null);
});

test('subjectTenant: legacy row without 0098 fields parses with defaults', () => {
  const parsed = subjectTenant.parse({
    id: '00000000-0000-4000-8000-000000000001',
    tenant_id: '00000000-0000-4000-8000-000000000002',
    name: 'Acme Pty Ltd',
    kind: 'claimant',
    created_at: '2026-05-31T10:00:00.000Z',
    updated_at: '2026-05-31T10:00:00.000Z',
  });
  assert.equal(parsed.entity_kind, 'standalone');
  assert.equal(parsed.head_company_id, undefined);
  assert.equal(parsed.aggregated_turnover_aud, undefined);
});

test('subjectTenant: head-company configuration round-trips', () => {
  const parsed = subjectTenant.parse({
    id: '00000000-0000-4000-8000-000000000001',
    tenant_id: '00000000-0000-4000-8000-000000000002',
    name: 'Acme Holdings',
    kind: 'claimant',
    created_at: '2026-05-31T10:00:00.000Z',
    updated_at: '2026-05-31T10:00:00.000Z',
    entity_kind: 'head_company',
    head_company_id: null,
    aggregated_turnover_aud: '18500000.00',
    aggregated_turnover_fy_label: 'FY26',
  });
  assert.equal(parsed.entity_kind, 'head_company');
  assert.equal(parsed.aggregated_turnover_aud, '18500000.00');
  // Derived: $18.5M < $20M → small-entity rate.
  assert.equal(offsetRateForAggregatedTurnover(parsed.aggregated_turnover_aud), OFFSET_RATE_SMALL);
});

test('subjectTenant: R&D entity round-trips with head_company_id', () => {
  const headId = '00000000-0000-4000-8000-000000000003';
  const parsed = subjectTenant.parse({
    id: '00000000-0000-4000-8000-000000000004',
    tenant_id: '00000000-0000-4000-8000-000000000002',
    name: 'Acme R&D Pty Ltd',
    kind: 'claimant',
    created_at: '2026-05-31T10:00:00.000Z',
    updated_at: '2026-05-31T10:00:00.000Z',
    entity_kind: 'r_and_d_entity',
    head_company_id: headId,
  });
  assert.equal(parsed.entity_kind, 'r_and_d_entity');
  assert.equal(parsed.head_company_id, headId);
});
