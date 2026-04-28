import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLAIM_TAB_VALUES, DEFAULT_CLAIM_TAB, parseTab, TAB_LABELS } from './url-params.js';

// parseTab -----------------------------------------------------------------

test('parseTab: "activities" returns "activities"', () => {
  assert.equal(parseTab('activities'), 'activities');
});

test('parseTab: each known tab round-trips', () => {
  // Defends against accidental drift between CLAIM_TAB_VALUES and the
  // accept-set inside parseTab — every literal in the list must parse
  // back to itself.
  for (const tab of CLAIM_TAB_VALUES) {
    assert.equal(parseTab(tab), tab);
  }
});

test('parseTab: null returns default ("activities")', () => {
  assert.equal(parseTab(null), DEFAULT_CLAIM_TAB);
  assert.equal(parseTab(null), 'activities');
});

test('parseTab: undefined returns default', () => {
  assert.equal(parseTab(undefined), DEFAULT_CLAIM_TAB);
});

test('parseTab: empty string returns default (treated as missing)', () => {
  assert.equal(parseTab(''), DEFAULT_CLAIM_TAB);
});

test('parseTab: unknown value returns default (graceful fallback for stale links)', () => {
  assert.equal(parseTab('foo'), DEFAULT_CLAIM_TAB);
  assert.equal(parseTab('Activities'), DEFAULT_CLAIM_TAB); // case-sensitive
});

// TAB_LABELS ---------------------------------------------------------------

test('TAB_LABELS: defines a label for every CLAIM_TAB_VALUES entry', () => {
  // If someone adds a tab to CLAIM_TAB_VALUES but forgets the label, the
  // tab strip would render `undefined`. This catches that drift.
  for (const tab of CLAIM_TAB_VALUES) {
    assert.equal(typeof TAB_LABELS[tab], 'string');
    assert.ok(TAB_LABELS[tab].length > 0, `label for ${tab} should be non-empty`);
  }
});
