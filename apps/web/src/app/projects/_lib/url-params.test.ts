import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_LIST_SORT_LABELS,
  PROJECT_LIST_STATUS_LABELS,
  PROJECT_TAB_LABELS,
  parseProjectListSort,
  parseProjectListStatus,
  parseProjectTab,
  type ProjectListSort,
  type ProjectListStatus,
  type ProjectTab,
} from './url-params.js';

/**
 * Pure-function tests for the /projects URL parsers (T-A7).
 *
 * Pattern mirrors the C4 `claims/[claim_id]/_lib/url-params.test.ts`
 * shape (commit 3593576 + 1daf474): each parser gets at least
 *   - a happy-path round-trip per accepted value
 *   - null / undefined / empty / unknown → default
 * plus a Record-vs-union drift-guard test that asserts every literal in
 * the union has a label, so a future widening of the union surfaces
 * here with a missing-key error.
 */

// ---------------------------------------------------------------------
// parseProjectListStatus
// ---------------------------------------------------------------------

test('parseProjectListStatus: round-trip "active"', () => {
  assert.equal(parseProjectListStatus('active'), 'active');
});

test('parseProjectListStatus: round-trip "archived"', () => {
  assert.equal(parseProjectListStatus('archived'), 'archived');
});

test('parseProjectListStatus: round-trip "all"', () => {
  assert.equal(parseProjectListStatus('all'), 'all');
});

test('parseProjectListStatus: null → "active" (default)', () => {
  assert.equal(parseProjectListStatus(null), 'active');
});

test('parseProjectListStatus: undefined → "active" (default)', () => {
  assert.equal(parseProjectListStatus(undefined), 'active');
});

test('parseProjectListStatus: empty string → "active" (default)', () => {
  assert.equal(parseProjectListStatus(''), 'active');
});

test('parseProjectListStatus: unknown value → "active" (default)', () => {
  assert.equal(parseProjectListStatus('inactive'), 'active');
});

test('parseProjectListStatus: case-sensitive — "Active" → default', () => {
  // The URL is canonical lowercase; a capitalised value is treated as
  // an unknown token and falls back to the default. Worth pinning so
  // future-me doesn't quietly add case-insensitive matching and then
  // discover the URL bookmark broke.
  assert.equal(parseProjectListStatus('Active'), 'active');
});

// ---------------------------------------------------------------------
// parseProjectTab
// ---------------------------------------------------------------------

test('parseProjectTab: round-trip "claims"', () => {
  assert.equal(parseProjectTab('claims'), 'claims');
});

test('parseProjectTab: round-trip "timeline"', () => {
  assert.equal(parseProjectTab('timeline'), 'timeline');
});

test('parseProjectTab: round-trip "settings"', () => {
  assert.equal(parseProjectTab('settings'), 'settings');
});

test('parseProjectTab: null → "claims" (default)', () => {
  assert.equal(parseProjectTab(null), 'claims');
});

test('parseProjectTab: undefined → "claims" (default)', () => {
  assert.equal(parseProjectTab(undefined), 'claims');
});

test('parseProjectTab: empty string → "claims" (default)', () => {
  assert.equal(parseProjectTab(''), 'claims');
});

test('parseProjectTab: unknown value → "claims" (default)', () => {
  assert.equal(parseProjectTab('overview'), 'claims');
});

// ---------------------------------------------------------------------
// parseProjectListSort
// ---------------------------------------------------------------------

test('parseProjectListSort: round-trip "name"', () => {
  assert.equal(parseProjectListSort('name'), 'name');
});

test('parseProjectListSort: round-trip "recent"', () => {
  assert.equal(parseProjectListSort('recent'), 'recent');
});

test('parseProjectListSort: round-trip "claim_count"', () => {
  assert.equal(parseProjectListSort('claim_count'), 'claim_count');
});

test('parseProjectListSort: null → "name" (default)', () => {
  assert.equal(parseProjectListSort(null), 'name');
});

test('parseProjectListSort: undefined → "name" (default)', () => {
  assert.equal(parseProjectListSort(undefined), 'name');
});

test('parseProjectListSort: empty string → "name" (default)', () => {
  assert.equal(parseProjectListSort(''), 'name');
});

test('parseProjectListSort: unknown value → "name" (default)', () => {
  assert.equal(parseProjectListSort('alphabetical'), 'name');
});

// ---------------------------------------------------------------------
// Label maps — drift guard. TypeScript's Record<X, string> is the primary
// defence (compile-time, every union member must have a key). The runtime
// check below is belt-and-braces: if a future contributor widens the
// union but forgets the label entry, the test still flags it loudly.
// ---------------------------------------------------------------------

test('PROJECT_TAB_LABELS: every union member has a label', () => {
  const expected: ReadonlyArray<ProjectTab> = ['claims', 'timeline', 'settings'];
  for (const tab of expected) {
    assert.ok(
      typeof PROJECT_TAB_LABELS[tab] === 'string' && PROJECT_TAB_LABELS[tab].length > 0,
      `missing label for tab=${tab}`,
    );
  }
});

test('PROJECT_LIST_STATUS_LABELS: every union member has a label', () => {
  const expected: ReadonlyArray<ProjectListStatus> = ['active', 'archived', 'all'];
  for (const status of expected) {
    assert.ok(
      typeof PROJECT_LIST_STATUS_LABELS[status] === 'string' &&
        PROJECT_LIST_STATUS_LABELS[status].length > 0,
      `missing label for status=${status}`,
    );
  }
});

test('PROJECT_LIST_SORT_LABELS: every union member has a label', () => {
  const expected: ReadonlyArray<ProjectListSort> = ['name', 'recent', 'claim_count'];
  for (const sort of expected) {
    assert.ok(
      typeof PROJECT_LIST_SORT_LABELS[sort] === 'string' &&
        PROJECT_LIST_SORT_LABELS[sort].length > 0,
      `missing label for sort=${sort}`,
    );
  }
});
