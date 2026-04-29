import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentFiscalYear, parseFiscalYear, parseStages, parseView } from './url-params.js';

// parseView ----------------------------------------------------------------

test('parseView: "kanban" returns "kanban"', () => {
  assert.equal(parseView('kanban'), 'kanban');
});

test('parseView: "table" returns "table"', () => {
  assert.equal(parseView('table'), 'table');
});

test('parseView: null returns "table" (default)', () => {
  assert.equal(parseView(null), 'table');
});

test('parseView: invalid value returns "table"', () => {
  assert.equal(parseView('grid'), 'table');
  assert.equal(parseView(''), 'table');
});

// parseStages --------------------------------------------------------------

test('parseStages: undefined returns []', () => {
  assert.deepEqual(parseStages(undefined), []);
});

test('parseStages: empty array returns []', () => {
  assert.deepEqual(parseStages([]), []);
});

test('parseStages: single valid stage returns array with that stage', () => {
  assert.deepEqual(parseStages(['engagement']), ['engagement']);
});

test('parseStages: multiple valid stages preserved', () => {
  assert.deepEqual(parseStages(['engagement', 'review']), ['engagement', 'review']);
});

test('parseStages: invalid value returns []', () => {
  assert.deepEqual(parseStages(['foo']), []);
});

test('parseStages: mixed valid + invalid filters out invalid', () => {
  assert.deepEqual(parseStages(['engagement', 'foo', 'review']), ['engagement', 'review']);
});

test('parseStages: duplicate values preserved (set dedupe is caller responsibility)', () => {
  // The toggle UI naturally dedupes on click; consumers should treat the
  // array as a set. We don't dedupe here because doing so would silently
  // mask bad URLs and consumers iterating once treat the duplicate as a
  // no-op anyway.
  assert.deepEqual(parseStages(['engagement', 'engagement']), ['engagement', 'engagement']);
});

// parseFiscalYear ----------------------------------------------------------

test('parseFiscalYear: valid digit string returns number', () => {
  assert.equal(parseFiscalYear('2026', 2025), 2026);
});

test('parseFiscalYear: null returns fallback', () => {
  assert.equal(parseFiscalYear(null, 2025), 2025);
});

test('parseFiscalYear: empty string returns fallback', () => {
  assert.equal(parseFiscalYear('', 2025), 2025);
});

test('parseFiscalYear: non-numeric returns fallback', () => {
  assert.equal(parseFiscalYear('abc', 2025), 2025);
});

test('parseFiscalYear: out-of-range below 1900 returns fallback', () => {
  assert.equal(parseFiscalYear('1850', 2025), 2025);
});

test('parseFiscalYear: out-of-range above 2200 returns fallback', () => {
  assert.equal(parseFiscalYear('9999', 2025), 2025);
});

test('parseFiscalYear: lower boundary 1900 is accepted', () => {
  assert.equal(parseFiscalYear('1900', 2025), 1900);
});

test('parseFiscalYear: upper boundary 2200 is accepted', () => {
  assert.equal(parseFiscalYear('2200', 2025), 2200);
});

// currentFiscalYear --------------------------------------------------------

test('currentFiscalYear: rolls over at local July 1', () => {
  // Construct via local-time `new Date(year, monthIdx, day)` so the test is
  // timezone-independent. JS months are 0-indexed: 5 = June, 6 = July.
  // 30 June 2026 → FY 2026 (current FY).
  assert.equal(currentFiscalYear(new Date(2026, 5, 30)), 2026);
  // 1 July 2026 → FY 2027 (new FY).
  assert.equal(currentFiscalYear(new Date(2026, 6, 1)), 2027);
});

test('currentFiscalYear: January is in the calendar-year-named FY', () => {
  // 15 January 2026 → FY 2026 (1 July 2025 - 30 June 2026).
  assert.equal(currentFiscalYear(new Date(2026, 0, 15)), 2026);
});

test('currentFiscalYear: December is in the next-year-named FY', () => {
  // 15 December 2025 → FY 2026 (1 July 2025 - 30 June 2026).
  assert.equal(currentFiscalYear(new Date(2025, 11, 15)), 2026);
});
