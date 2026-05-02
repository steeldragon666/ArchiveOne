import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EXPENDITURE_CONFIDENCE_THRESHOLDS } from './thresholds.js';

test('AUTO_APPLY is strictly greater than REVIEW_RECOMMENDED', () => {
  assert.ok(
    EXPENDITURE_CONFIDENCE_THRESHOLDS.AUTO_APPLY >
      EXPENDITURE_CONFIDENCE_THRESHOLDS.REVIEW_RECOMMENDED,
    'AUTO_APPLY must be a tighter bar than REVIEW_RECOMMENDED',
  );
});

test('both thresholds lie within [0, 1]', () => {
  for (const [name, value] of Object.entries(EXPENDITURE_CONFIDENCE_THRESHOLDS)) {
    assert.ok(value >= 0 && value <= 1, `${name}=${value} must be in [0, 1]`);
  }
});

test('thresholds are numeric (not stringly-typed by accident)', () => {
  assert.equal(typeof EXPENDITURE_CONFIDENCE_THRESHOLDS.AUTO_APPLY, 'number');
  assert.equal(typeof EXPENDITURE_CONFIDENCE_THRESHOLDS.REVIEW_RECOMMENDED, 'number');
});

test('Phase-1 default values match the P6 design doc', () => {
  // Defense-in-depth: catch silent edits that drift the calibration.
  // Bumping these values is a deliberate change — update this assertion in
  // the same PR.
  assert.equal(EXPENDITURE_CONFIDENCE_THRESHOLDS.AUTO_APPLY, 0.85);
  assert.equal(EXPENDITURE_CONFIDENCE_THRESHOLDS.REVIEW_RECOMMENDED, 0.7);
});
