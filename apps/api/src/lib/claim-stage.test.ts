import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStageTransition } from './claim-stage.js';
import { CLAIM_STAGES_LITERAL } from '@cpa/schemas';

test('all forward transitions are valid for consultant role', () => {
  for (let i = 0; i < CLAIM_STAGES_LITERAL.length; i++) {
    for (let j = i + 1; j < CLAIM_STAGES_LITERAL.length; j++) {
      const from = CLAIM_STAGES_LITERAL[i]!;
      const to = CLAIM_STAGES_LITERAL[j]!;
      const result = validateStageTransition({ from, to, role: 'consultant' });
      assert.equal(result.ok, true, `${from} → ${to} should be ok`);
      if (result.ok) {
        assert.equal(result.direction, 'forward');
      }
    }
  }
});

test('count of valid forward transitions is exactly C(7, 2) = 21', () => {
  let count = 0;
  for (let i = 0; i < CLAIM_STAGES_LITERAL.length; i++) {
    for (let j = i + 1; j < CLAIM_STAGES_LITERAL.length; j++) {
      const r = validateStageTransition({
        from: CLAIM_STAGES_LITERAL[i]!,
        to: CLAIM_STAGES_LITERAL[j]!,
        role: 'consultant',
      });
      if (r.ok) count++;
    }
  }
  assert.equal(count, 21, 'expected 21 forward transitions for 7-stage pipeline');
});

test('backward transition allowed for admin (except from submitted)', () => {
  // review → activity_capture (admin)
  const r = validateStageTransition({
    from: 'review',
    to: 'activity_capture',
    role: 'admin',
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.direction, 'backward');
});

test('backward transition rejected for consultant', () => {
  const r = validateStageTransition({
    from: 'review',
    to: 'activity_capture',
    role: 'consultant',
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'role_required');
});

test('backward transition rejected for viewer', () => {
  const r = validateStageTransition({
    from: 'review',
    to: 'activity_capture',
    role: 'viewer',
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'role_required');
});

test('cannot revert from submitted (admin)', () => {
  const r = validateStageTransition({
    from: 'submitted',
    to: 'review',
    role: 'admin',
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'cannot_revert_from_submitted');
});

test('forward from submitted to audit_defence is OK (admin)', () => {
  const r = validateStageTransition({
    from: 'submitted',
    to: 'audit_defence',
    role: 'admin',
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.direction, 'forward');
});

test('no-op (from === to) returns no_op error', () => {
  const r = validateStageTransition({
    from: 'review',
    to: 'review',
    role: 'admin',
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'no_op');
});

test('unknown target stage rejected', () => {
  const r = validateStageTransition({
    from: 'review',
    // @ts-expect-error — testing runtime safety with bogus input
    to: 'finalised',
    role: 'admin',
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'invalid_target');
});

test('unknown from stage rejected', () => {
  const r = validateStageTransition({
    // @ts-expect-error — testing runtime safety with bogus input
    from: 'pre_engagement',
    to: 'engagement',
    role: 'admin',
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'invalid_target');
});
