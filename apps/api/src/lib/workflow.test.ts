import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAgree,
  applyReopen,
  canAdvance,
  initialWorkflowState,
  type WorkflowSnapshot,
} from './workflow.js';

const empty: WorkflowSnapshot = {
  eventsClassified: 0,
  proposedActivitiesPending: 0,
  proposedActivitiesTotal: 0,
  agreedActivitiesTotal: 0,
  agreedActivitiesWithoutBinding: 0,
  narrativeSectionsApproved: 0,
};

test('canAdvance step 1 requires at least one classified event', () => {
  assert.equal(canAdvance(1, empty).ok, false);
  assert.equal(canAdvance(1, { ...empty, eventsClassified: 1 }).ok, true);
});

test('canAdvance step 2 requires all proposed activities resolved', () => {
  // some pending → blocked
  const r1 = canAdvance(2, { ...empty, proposedActivitiesTotal: 4, proposedActivitiesPending: 2 });
  assert.equal(r1.ok, false);
  // all resolved → allowed (even if zero proposed)
  const r2 = canAdvance(2, { ...empty, proposedActivitiesTotal: 4, proposedActivitiesPending: 0 });
  assert.equal(r2.ok, true);
});

test('canAdvance step 3 requires every agreed activity bound to evidence', () => {
  const r1 = canAdvance(3, {
    ...empty,
    agreedActivitiesTotal: 3,
    agreedActivitiesWithoutBinding: 1,
  });
  assert.equal(r1.ok, false);
  const r2 = canAdvance(3, {
    ...empty,
    agreedActivitiesTotal: 3,
    agreedActivitiesWithoutBinding: 0,
  });
  assert.equal(r2.ok, true);
});

test('canAdvance step 4 requires 4 approved narrative sections', () => {
  assert.equal(canAdvance(4, { ...empty, narrativeSectionsApproved: 3 }).ok, false);
  assert.equal(canAdvance(4, { ...empty, narrativeSectionsApproved: 4 }).ok, true);
});

test('canAdvance step 5 is terminal — always returns ok=false with terminal reason', () => {
  const r = canAdvance(5, empty);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /terminal/i);
});

test('applyAgree writes timestamp + actor on the named step', () => {
  const state = initialWorkflowState('2026-05-12T00:00:00Z');
  const next = applyAgree(state, 2, '00000000-0000-4000-8000-000000000001', '2026-05-12T01:00:00Z');
  assert.equal(next.steps['2']?.agreed_at, '2026-05-12T01:00:00Z');
  assert.equal(next.steps['2']?.agreed_by, '00000000-0000-4000-8000-000000000001');
  // Untouched steps remain null
  assert.equal(next.steps['3'], null);
  // Pure: original untouched
  assert.equal(state.steps['2'], null);
});

test('applyReopen clears the named step (no cascade)', () => {
  const s0 = initialWorkflowState('2026-05-12T00:00:00Z');
  const s1 = applyAgree(s0, 2, '00000000-0000-4000-8000-000000000001', '2026-05-12T01:00:00Z');
  const s2 = applyAgree(s1, 3, '00000000-0000-4000-8000-000000000001', '2026-05-12T02:00:00Z');
  // Reopen step 2 — step 3 stays agreed (no cascade per Q5.b)
  const s3 = applyReopen(s2, 2);
  assert.equal(s3.steps['2'], null);
  assert.equal(s3.steps['3']?.agreed_at, '2026-05-12T02:00:00Z');
});

test('initialWorkflowState fills all five steps with null', () => {
  const s = initialWorkflowState('2026-05-12T00:00:00Z');
  for (const k of ['1', '2', '3', '4', '5'] as const) {
    assert.equal(s.steps[k], null);
  }
});
