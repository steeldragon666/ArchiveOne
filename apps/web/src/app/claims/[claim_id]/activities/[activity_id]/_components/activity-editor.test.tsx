import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Activity } from '@cpa/schemas';
import { computeChangedFields } from '../../_lib/diff.js';

/**
 * Pure-function tests for the activity-editor's diff helper.
 *
 * apps/web has no jsdom, so the React component itself is exercised
 * via Playwright e2e (deferred to T-A10). The diff logic is the part
 * worth unit-testing here:
 *   - Empty patch when nothing changed.
 *   - Title round-trips as a string.
 *   - Cleared narrative fields map to `null` (matching DB nullable
 *     storage and the audit-chain field-diff representation).
 *   - Filled narrative fields round-trip as strings.
 *   - Unchanged null fields stay omitted.
 */

const baseActivity: Activity = {
  id: 'a000-0000-0000-0000-000000000000',
  tenant_id: 't000-0000-0000-0000-000000000000',
  project_id: 'p000-0000-0000-0000-000000000000',
  claim_id: 'c000-0000-0000-0000-000000000000',
  code: 'CA-01',
  kind: 'core',
  title: 'Original title',
  description: 'desc',
  hypothesis: null,
  technical_uncertainty: 'tu',
  experimentation_log: null,
  expected_outcome: null,
  actual_outcome: null,
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-15T00:00:00.000Z',
  // portal_fields is required on the Activity type (default `{}`) since
  // migration 0044 + the schema's `z.record(z.unknown()).default({})`.
  // computeChangedFields doesn't touch portal_fields, so the empty default
  // is fine for these tests.
  portal_fields: {},
  // portal_fields_history landed in migration 0080 with default `[]`.
  portal_fields_history: [],
  // R&DTI gap-foundation columns (migration 0097) — required by the
  // Activity Zod schema with documented defaults. computeChangedFields
  // doesn't touch any of them, so default-empty is fine for these tests.
  performed_overseas: false,
  overseas_findings_required: false,
  overseas_findings_obtained: false,
  performer_kind: 'in_house',
};

test('computeChangedFields: returns {} when no fields changed', () => {
  const patch = computeChangedFields(baseActivity, {
    title: 'Original title',
    description: 'desc',
    hypothesis: '',
    technical_uncertainty: 'tu',
    experimentation_log: '',
    expected_outcome: '',
    actual_outcome: '',
  });
  assert.deepEqual(patch, {});
});

test('computeChangedFields: title change is included as a string', () => {
  const patch = computeChangedFields(baseActivity, {
    title: 'New title',
    description: 'desc',
    hypothesis: '',
    technical_uncertainty: 'tu',
    experimentation_log: '',
    expected_outcome: '',
    actual_outcome: '',
  });
  assert.deepEqual(patch, { title: 'New title' });
});

test('computeChangedFields: clearing a non-null narrative field maps to null', () => {
  const patch = computeChangedFields(baseActivity, {
    title: 'Original title',
    description: '',
    hypothesis: '',
    technical_uncertainty: 'tu',
    experimentation_log: '',
    expected_outcome: '',
    actual_outcome: '',
  });
  assert.deepEqual(patch, { description: null });
});

test('computeChangedFields: filling a null narrative field round-trips as a string', () => {
  const patch = computeChangedFields(baseActivity, {
    title: 'Original title',
    description: 'desc',
    hypothesis: 'My new hypothesis',
    technical_uncertainty: 'tu',
    experimentation_log: '',
    expected_outcome: '',
    actual_outcome: '',
  });
  assert.deepEqual(patch, { hypothesis: 'My new hypothesis' });
});

test('computeChangedFields: multiple narrative changes accumulate', () => {
  const patch = computeChangedFields(baseActivity, {
    title: 'Refined title',
    description: 'updated desc',
    hypothesis: 'fresh hypothesis',
    technical_uncertainty: '', // cleared
    experimentation_log: 'logs added',
    expected_outcome: '',
    actual_outcome: 'observed result',
  });
  assert.deepEqual(patch, {
    title: 'Refined title',
    description: 'updated desc',
    hypothesis: 'fresh hypothesis',
    technical_uncertainty: null,
    experimentation_log: 'logs added',
    actual_outcome: 'observed result',
  });
});

test('computeChangedFields: unchanged null fields stay omitted', () => {
  // Original.hypothesis is null; if the form sends '' (the canonical
  // form representation of null), no change should be reported.
  const patch = computeChangedFields(baseActivity, {
    title: 'Original title',
    description: 'desc',
    hypothesis: '',
    technical_uncertainty: 'tu',
    experimentation_log: '',
    expected_outcome: '',
    actual_outcome: '',
  });
  assert.equal('hypothesis' in patch, false);
});
