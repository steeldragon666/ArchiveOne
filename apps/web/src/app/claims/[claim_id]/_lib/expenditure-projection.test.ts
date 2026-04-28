import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectMappingFromEvents, type ProjectableEvent } from './expenditure-projection.js';

const E1 = '00000000-0000-0000-0000-0000000000e1';
const E2 = '00000000-0000-0000-0000-0000000000e2';
const A1 = '00000000-0000-0000-0000-00000000ca01';
const A2 = '00000000-0000-0000-0000-00000000ca02';

const make = (
  expenditure_id: string,
  activity_id: string,
  activity_code: string,
  activity_title: string,
  captured_at: string,
): ProjectableEvent => ({
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

test('projectMappingFromEvents: does not mutate input array', () => {
  const events = [
    make(E1, A1, 'CA-001', 'First', '2026-04-25T10:00:00.000Z'),
    make(E1, A2, 'CA-002', 'Second', '2026-04-26T11:00:00.000Z'),
  ];
  const before = JSON.parse(JSON.stringify(events)) as ProjectableEvent[];
  projectMappingFromEvents(events);
  assert.deepEqual(events, before);
});
