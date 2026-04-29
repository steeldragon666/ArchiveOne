import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectMappingFromEvents, type ProjectableEvent } from './expenditure-projection.js';

const E1 = '00000000-0000-0000-0000-0000000000e1';
const E2 = '00000000-0000-0000-0000-0000000000e2';
const A1 = '00000000-0000-0000-0000-00000000ca01';
const A2 = '00000000-0000-0000-0000-00000000ca02';

// Counter for synthesising distinct event ids inside `make`. Tests that
// care about the tie-breaker pass an explicit id — see the two
// "identical captured_at" tests at the bottom of the file.
let __eventIdCounter = 0;
const nextEventId = (): string => {
  __eventIdCounter += 1;
  // 12-char trailing segment, hex-only, deterministic across runs.
  const hex = __eventIdCounter.toString(16).padStart(12, '0');
  return `00000000-0000-0000-0000-${hex}`;
};

const make = (
  expenditure_id: string,
  activity_id: string,
  activity_code: string,
  activity_title: string,
  captured_at: string,
  id: string = nextEventId(),
): ProjectableEvent => ({
  id,
  kind: 'EXPENDITURE_MAPPED',
  captured_at,
  payload: {
    expenditure_id,
    activity_id,
    activity_code,
    activity_title,
    mapped_at: captured_at,
  },
});

test('projectMappingFromEvents: empty input returns empty map', () => {
  assert.deepEqual(projectMappingFromEvents([]), {});
});

test('projectMappingFromEvents: single event populates one key', () => {
  const out = projectMappingFromEvents([make(E1, A1, 'CA-001', 'Foo', '2026-04-25T10:00:00.000Z')]);
  assert.equal(Object.keys(out).length, 1);
  assert.equal(out[E1]?.activity_id, A1);
  assert.equal(out[E1]?.activity_code, 'CA-001');
});

test('projectMappingFromEvents: latest captured_at wins for the same expenditure', () => {
  const events = [
    make(E1, A1, 'CA-001', 'First mapping', '2026-04-25T10:00:00.000Z'),
    make(E1, A2, 'CA-002', 'Second mapping', '2026-04-26T11:00:00.000Z'),
  ];
  const out = projectMappingFromEvents(events);
  // CA-002 (later) replaces CA-001.
  assert.equal(out[E1]?.activity_id, A2);
  assert.equal(out[E1]?.activity_code, 'CA-002');
});

test('projectMappingFromEvents: order-insensitive — reversed input yields same result', () => {
  // Pure projection: re-ordering the input must not change the output
  // (latest captured_at wins regardless of stream position).
  const events = [
    make(E1, A1, 'CA-001', 'First', '2026-04-25T10:00:00.000Z'),
    make(E1, A2, 'CA-002', 'Second', '2026-04-26T11:00:00.000Z'),
  ];
  const forward = projectMappingFromEvents(events);
  const reverse = projectMappingFromEvents([...events].reverse());
  assert.deepEqual(forward, reverse);
});

test('projectMappingFromEvents: multiple expenditures each get their own latest', () => {
  const events = [
    make(E1, A1, 'CA-001', 'For E1', '2026-04-25T10:00:00.000Z'),
    make(E2, A2, 'CA-002', 'For E2', '2026-04-26T11:00:00.000Z'),
    // Add a stale event for E1 — should still be beaten by the original.
    make(E1, A2, 'CA-002', 'Earlier for E1', '2026-04-20T09:00:00.000Z'),
  ];
  const out = projectMappingFromEvents(events);
  assert.equal(Object.keys(out).length, 2);
  assert.equal(out[E1]?.activity_id, A1); // still the 25th's mapping
  assert.equal(out[E2]?.activity_id, A2);
});

test('projectMappingFromEvents: ignores events whose kind is not EXPENDITURE_MAPPED', () => {
  // The caller can pass a heterogeneous event stream and the projection
  // narrows. Robust against future readers that don't pre-filter.
  const events: ProjectableEvent[] = [
    {
      id: nextEventId(),
      kind: 'EXPENDITURE_INGESTED',
      captured_at: '2026-04-25T10:00:00.000Z',
      payload: {
        expenditure_id: E1,
        activity_id: A1,
        activity_code: 'CA-001',
        activity_title: 'Should be ignored',
        mapped_at: '2026-04-25T10:00:00.000Z',
      },
    },
    make(E1, A2, 'CA-002', 'Real mapping', '2026-04-26T11:00:00.000Z'),
  ];
  const out = projectMappingFromEvents(events);
  assert.equal(out[E1]?.activity_id, A2);
});

test('projectMappingFromEvents: two events with identical captured_at — higher id wins', () => {
  // The chain assigns distinct captured_ats in practice, but tests and
  // backfills can produce ties. The projection breaks the tie on
  // lexicographic event id so the result is deterministic.
  const t = '2026-04-29T10:00:00.000Z';
  const events: ProjectableEvent[] = [
    make(E1, A1, 'CA-001', 'Lower id', t, '00000000-0000-0000-0000-0000000e0001'),
    make(E1, A2, 'CA-002', 'Higher id', t, '00000000-0000-0000-0000-0000000e0002'),
  ];
  const out = projectMappingFromEvents(events);
  // Higher id (e0002) wins, so A2 / CA-002 is the projected mapping.
  assert.equal(out[E1]?.activity_id, A2);
  assert.equal(out[E1]?.activity_code, 'CA-002');
});

test('projectMappingFromEvents: tie-breaker is order-INSENSITIVE — reversed input gives same answer', () => {
  // Same events as the previous test, reversed. Without the id
  // tie-breaker the projection would flip; with it, the answer is
  // stable regardless of input order.
  const t = '2026-04-29T10:00:00.000Z';
  const events: ProjectableEvent[] = [
    make(E1, A1, 'CA-001', 'Lower id', t, '00000000-0000-0000-0000-0000000e0001'),
    make(E1, A2, 'CA-002', 'Higher id', t, '00000000-0000-0000-0000-0000000e0002'),
  ].reverse();
  const out = projectMappingFromEvents(events);
  // Still A2 — id-based tie-break is order-insensitive.
  assert.equal(out[E1]?.activity_id, A2);
  assert.equal(out[E1]?.activity_code, 'CA-002');
});

test('projectMappingFromEvents: does not mutate input array', () => {
  const events = [
    make(E1, A1, 'CA-001', 'First', '2026-04-25T10:00:00.000Z'),
    make(E1, A2, 'CA-002', 'Second', '2026-04-26T11:00:00.000Z'),
  ];
  const before = JSON.parse(JSON.stringify(events)) as ProjectableEvent[];
  projectMappingFromEvents(events);
  assert.deepEqual(events, before);
});
