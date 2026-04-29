import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMappingOptimistic,
  filterExpenditures,
  formatAmount,
  STUB_ACTIVITY_IDS,
  STUB_EXPENDITURES,
  type ExpenditureMapping,
  type ExpenditureRow,
} from './expenditure-stub.js';

// filterExpenditures ------------------------------------------------------

test('filterExpenditures: "all" returns every row (no narrowing)', () => {
  const out = filterExpenditures(STUB_EXPENDITURES, 'all');
  assert.equal(out.length, STUB_EXPENDITURES.length);
});

test('filterExpenditures: "unmapped" returns only rows without current_mapping', () => {
  const out = filterExpenditures(STUB_EXPENDITURES, 'unmapped');
  // Every returned row must lack a mapping.
  for (const r of out) assert.equal(r.current_mapping, undefined);
  // And the count must equal the fixture's unmapped count.
  const expected = STUB_EXPENDITURES.filter((r) => !r.current_mapping).length;
  assert.equal(out.length, expected);
});

test('filterExpenditures: "mapped" returns only rows with current_mapping', () => {
  const out = filterExpenditures(STUB_EXPENDITURES, 'mapped');
  for (const r of out) assert.ok(r.current_mapping, 'mapped row must carry a mapping');
  const expected = STUB_EXPENDITURES.filter((r) => Boolean(r.current_mapping)).length;
  assert.equal(out.length, expected);
});

test('filterExpenditures: returns a new array (does not mutate input)', () => {
  // Defends against future "use unique" optimisations that might return
  // the input directly — the rest of the page passes the filtered list
  // to setState and expects React to detect the change.
  const out = filterExpenditures(STUB_EXPENDITURES, 'all');
  assert.notEqual(out, STUB_EXPENDITURES);
});

test('filterExpenditures: empty input returns empty for any filter', () => {
  assert.deepEqual(filterExpenditures([], 'all'), []);
  assert.deepEqual(filterExpenditures([], 'unmapped'), []);
  assert.deepEqual(filterExpenditures([], 'mapped'), []);
});

// applyMappingOptimistic --------------------------------------------------

const SAMPLE_MAPPING: ExpenditureMapping = {
  activity_id: STUB_ACTIVITY_IDS.CA_002,
  activity_code: 'CA-002',
  activity_title: 'Sensor calibration trial',
  mapped_at: '2026-04-29T10:00:00.000Z',
};

test('applyMappingOptimistic: sets current_mapping on the matching row, leaves others alone', () => {
  // Pick an unmapped row from the fixture so the change is visible.
  const target = STUB_EXPENDITURES.find((r) => !r.current_mapping);
  assert.ok(target, 'fixture must have at least one unmapped row');
  const out = applyMappingOptimistic(STUB_EXPENDITURES, target.id, SAMPLE_MAPPING);
  // Length unchanged.
  assert.equal(out.length, STUB_EXPENDITURES.length);
  // Target row mutated.
  const updated = out.find((r) => r.id === target.id);
  assert.deepEqual(updated?.current_mapping, SAMPLE_MAPPING);
  // Other rows preserved by reference (cheap structural check).
  for (const r of out) {
    if (r.id === target.id) continue;
    assert.equal(
      r,
      STUB_EXPENDITURES.find((x) => x.id === r.id),
    );
  }
});

test('applyMappingOptimistic: re-mapping replaces an existing current_mapping', () => {
  const target = STUB_EXPENDITURES.find((r) => Boolean(r.current_mapping));
  assert.ok(target, 'fixture must have at least one mapped row');
  const out = applyMappingOptimistic(STUB_EXPENDITURES, target.id, SAMPLE_MAPPING);
  const updated = out.find((r) => r.id === target.id);
  // The previous mapping is gone — we don't keep history client-side; the
  // event chain on the server is the only history surface.
  assert.deepEqual(updated?.current_mapping, SAMPLE_MAPPING);
  assert.notEqual(updated?.current_mapping?.activity_id, target.current_mapping?.activity_id);
});

test('applyMappingOptimistic: unknown id is a no-op (returns equivalent rows)', () => {
  const out = applyMappingOptimistic(STUB_EXPENDITURES, 'no-such-id', SAMPLE_MAPPING);
  assert.equal(out.length, STUB_EXPENDITURES.length);
  // No row gained the new mapping.
  assert.equal(
    out.find((r) => r.current_mapping?.activity_id === SAMPLE_MAPPING.activity_id),
    undefined,
  );
});

test('applyMappingOptimistic: does not mutate input array or row objects', () => {
  const target = STUB_EXPENDITURES[0];
  assert.ok(target);
  const before = JSON.parse(JSON.stringify(STUB_EXPENDITURES)) as ExpenditureRow[];
  applyMappingOptimistic(STUB_EXPENDITURES, target.id, SAMPLE_MAPPING);
  // Nothing changed in the input.
  assert.deepEqual(STUB_EXPENDITURES, before);
});

// formatAmount ------------------------------------------------------------

test('formatAmount: AUD renders with $ prefix', () => {
  // Intl outputs include a U+00A0 NBSP (non-breaking space) in some
  // locale/runtime combinations; assert by substring rather than exact
  // string to avoid environment drift.
  const out = formatAmount('1234.56', 'AUD');
  assert.match(out, /\$/);
  assert.match(out, /1,234\.56/);
});

test('formatAmount: USD renders distinctly from AUD (different symbol/prefix)', () => {
  const aud = formatAmount('100.00', 'AUD');
  const usd = formatAmount('100.00', 'USD');
  assert.notEqual(aud, usd);
});

test('formatAmount: malformed amount falls back to "{amount} {currency}"', () => {
  // Defends the row UI against a stub fixture typo or a future API that
  // returns an unparseable amount — render something legible rather
  // than NaN.
  assert.equal(formatAmount('not-a-number', 'AUD'), 'not-a-number AUD');
});

test('formatAmount: unknown currency code falls back gracefully', () => {
  // Intl.NumberFormat throws RangeError on unknown ISO 4217 codes; the
  // formatter must catch and degrade to the raw label.
  const out = formatAmount('100.00', 'XYZ');
  // Either the runtime accepts XYZ (some Node builds do) — in which
  // case the output is something like "XYZ 100.00" — or it throws and
  // we fall back. Both shapes contain the amount and the code.
  assert.match(out, /100\.00/);
  assert.match(out, /XYZ/);
});

test('formatAmount: zero amount renders as $0.00 (not blank)', () => {
  const out = formatAmount('0.00', 'AUD');
  assert.match(out, /0\.00/);
});
