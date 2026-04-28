import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAIM_TAB_VALUES,
  DEFAULT_CLAIM_TAB,
  nextTabFromKey,
  parseTab,
  TAB_LABELS,
} from './url-params.js';

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
  // TS already enforces Record<ClaimTab, string> at compile-time — this
  // runtime check is belt-and-braces to catch the case where someone widens
  // ClaimTab without updating TAB_LABELS. Cheap insurance against future
  // divergence.
  for (const tab of CLAIM_TAB_VALUES) {
    assert.equal(typeof TAB_LABELS[tab], 'string');
    assert.ok(TAB_LABELS[tab].length > 0, `label for ${tab} should be non-empty`);
  }
});

// nextTabFromKey ----------------------------------------------------------
//
// Pure helper for the WAI-ARIA APG keyboard-nav pattern on claim-tabs.tsx.
// The component-level test (focus actually moving in the DOM) is a
// Playwright concern — apps/web has no jsdom. Here we exercise the
// branching: each key maps to the right neighbour, wraps at boundaries,
// returns null for non-handled keys.

test('nextTabFromKey: ArrowRight from "activities" → "evidence"', () => {
  assert.equal(nextTabFromKey('ArrowRight', 'activities'), 'evidence');
});

test('nextTabFromKey: ArrowDown is treated the same as ArrowRight (next)', () => {
  assert.equal(nextTabFromKey('ArrowDown', 'activities'), 'evidence');
});

test('nextTabFromKey: ArrowRight from last tab wraps to first', () => {
  assert.equal(nextTabFromKey('ArrowRight', 'timeline'), 'activities');
});

test('nextTabFromKey: ArrowLeft from "evidence" → "activities"', () => {
  assert.equal(nextTabFromKey('ArrowLeft', 'evidence'), 'activities');
});

test('nextTabFromKey: ArrowUp is treated the same as ArrowLeft (previous)', () => {
  assert.equal(nextTabFromKey('ArrowUp', 'evidence'), 'activities');
});

test('nextTabFromKey: ArrowLeft from first tab wraps to last', () => {
  assert.equal(nextTabFromKey('ArrowLeft', 'activities'), 'timeline');
});

test('nextTabFromKey: Home returns the first tab regardless of current', () => {
  assert.equal(nextTabFromKey('Home', 'expenditure'), 'activities');
  assert.equal(nextTabFromKey('Home', 'activities'), 'activities');
});

test('nextTabFromKey: End returns the last tab regardless of current', () => {
  assert.equal(nextTabFromKey('End', 'expenditure'), 'timeline');
  assert.equal(nextTabFromKey('End', 'timeline'), 'timeline');
});

test('nextTabFromKey: unhandled keys return null (caller preserves native behaviour)', () => {
  assert.equal(nextTabFromKey('Tab', 'activities'), null);
  assert.equal(nextTabFromKey('Enter', 'activities'), null);
  assert.equal(nextTabFromKey(' ', 'activities'), null);
  assert.equal(nextTabFromKey('Escape', 'activities'), null);
  assert.equal(nextTabFromKey('a', 'activities'), null);
});

test('nextTabFromKey: full ArrowRight cycle visits every tab and wraps', () => {
  // Defends against off-by-one drift in the wrap arithmetic.
  let current: (typeof CLAIM_TAB_VALUES)[number] = 'activities';
  const visited: string[] = [current];
  for (let i = 0; i < CLAIM_TAB_VALUES.length; i += 1) {
    const next = nextTabFromKey('ArrowRight', current);
    assert.ok(next !== null);
    current = next;
    visited.push(current);
  }
  // Visited each tab in CLAIM_TAB_VALUES order, then wrapped back to the start.
  assert.deepEqual(visited, [...CLAIM_TAB_VALUES, 'activities']);
});
