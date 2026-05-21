import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectMapping, type MappingChainEvent } from './expenditure-projection.js';

const ev = (
  kind: MappingChainEvent['kind'],
  payload: Record<string, unknown>,
  at: string,
  id: string,
): MappingChainEvent => ({ kind, payload, captured_at: at, id });

test('projectMapping: empty event list returns null', () => {
  assert.equal(projectMapping([]), null);
});

test('projectMapping: single MAPPED → single-kind mapping', () => {
  const out = projectMapping([
    ev(
      'EXPENDITURE_MAPPED',
      { activity_id: 'a1', activity_code: 'CA-001', activity_title: 'Activity 1' },
      '2026-05-01T00:00:00Z',
      'e1',
    ),
  ]);
  assert.deepEqual(out, {
    kind: 'single',
    activity_id: 'a1',
    activity_code: 'CA-001',
    activity_title: 'Activity 1',
  });
});

test('projectMapping: MAPPED → APPORTIONED → apportioned wins', () => {
  const out = projectMapping([
    ev(
      'EXPENDITURE_MAPPED',
      { activity_id: 'a1', activity_code: 'CA-001', activity_title: 'Activity 1' },
      '2026-05-01T00:00:00Z',
      'e1',
    ),
    ev(
      'EXPENDITURE_APPORTIONED',
      {
        allocations: [
          {
            activity_id: 'a1',
            activity_code: 'CA-001',
            activity_title: 'Activity 1',
            percentage: 60,
          },
          {
            activity_id: 'a2',
            activity_code: 'CA-002',
            activity_title: 'Activity 2',
            percentage: 40,
          },
        ],
      },
      '2026-05-02T00:00:00Z',
      'e2',
    ),
  ]);
  assert.equal(out?.kind, 'apportioned');
  if (out?.kind === 'apportioned') assert.equal(out.allocations.length, 2);
});

test('projectMapping: APPORTIONED → MAPPED → single wins', () => {
  const out = projectMapping([
    ev(
      'EXPENDITURE_APPORTIONED',
      {
        allocations: [
          { activity_id: 'a1', activity_code: 'CA-001', activity_title: 'A1', percentage: 50 },
          { activity_id: 'a2', activity_code: 'CA-002', activity_title: 'A2', percentage: 50 },
        ],
      },
      '2026-05-01T00:00:00Z',
      'e1',
    ),
    ev(
      'EXPENDITURE_MAPPED',
      { activity_id: 'a3', activity_code: 'CA-003', activity_title: 'A3' },
      '2026-05-02T00:00:00Z',
      'e2',
    ),
  ]);
  assert.equal(out?.kind, 'single');
  if (out?.kind === 'single') assert.equal(out.activity_id, 'a3');
});

test('projectMapping: MAPPED → UNMAPPED → null', () => {
  const out = projectMapping([
    ev(
      'EXPENDITURE_MAPPED',
      { activity_id: 'a1', activity_code: 'CA-001', activity_title: 'A1' },
      '2026-05-01T00:00:00Z',
      'e1',
    ),
    ev('EXPENDITURE_UNMAPPED', { prior_activity_id: 'a1' }, '2026-05-02T00:00:00Z', 'e2'),
  ]);
  assert.equal(out, null);
});

test('projectMapping: latest by (captured_at, id) wins regardless of input order', () => {
  // Three MAPPED events at same instant, different ids — highest id wins.
  const out = projectMapping([
    ev(
      'EXPENDITURE_MAPPED',
      { activity_id: 'a1', activity_code: 'CA-001', activity_title: 'A1' },
      '2026-05-01T00:00:00Z',
      'e1',
    ),
    ev(
      'EXPENDITURE_MAPPED',
      { activity_id: 'a3', activity_code: 'CA-003', activity_title: 'A3' },
      '2026-05-01T00:00:00Z',
      'e3',
    ),
    ev(
      'EXPENDITURE_MAPPED',
      { activity_id: 'a2', activity_code: 'CA-002', activity_title: 'A2' },
      '2026-05-01T00:00:00Z',
      'e2',
    ),
  ]);
  assert.equal(out?.kind, 'single');
  if (out?.kind === 'single') assert.equal(out.activity_id, 'a3');
});
