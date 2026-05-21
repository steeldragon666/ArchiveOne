/**
 * Parity test: server projection vs client projection.
 *
 * The two implementations have DIFFERENT interfaces:
 *
 *   server `projectMapping(events)`:
 *     - Input:  MappingChainEvent[] for ONE expenditure
 *     - Output: CurrentMapping (SingleMapping | ApportionedMapping | null)
 *     - Handles: MAPPED, APPORTIONED, UNMAPPED
 *
 *   client `projectMappingFromEvents(events)`:
 *     - Input:  ProjectableEvent[] (multi-expenditure, any-kind stream)
 *     - Output: Record<string, PlannedExpenditureMappedPayload>
 *     - Handles: MAPPED only (ignores all other kinds)
 *
 * Therefore parity is only testable for MAPPED-only chains. For
 * APPORTIONED and UNMAPPED chains, the client produces an empty map
 * or stale result — this is expected and documented here, not a bug.
 * The client was written before the A-endpoints design finalized;
 * when it's updated to handle all three kinds, these tests expand.
 *
 * Adapter strategy: for each MAPPED-only chain we feed both sides the
 * same events. We compare the server's SingleMapping fields against
 * the client's payload for the same expenditure_id.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectMapping, type MappingChainEvent } from './expenditure-projection.js';
import {
  projectMappingFromEvents,
  type ProjectableEvent,
} from '../../../../apps/web/src/app/claims/[claim_id]/_lib/expenditure-projection.js';

// ---------------------------------------------------------------------------
// Adapter: server MappingChainEvent → client ProjectableEvent
// The client expects `payload.expenditure_id` and `payload.mapped_at`.
// ---------------------------------------------------------------------------
const EXP_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function toClientEvents(serverEvents: MappingChainEvent[]): ProjectableEvent[] {
  return serverEvents.map((e) => ({
    id: e.id,
    kind: e.kind,
    captured_at: e.captured_at,
    payload: {
      expenditure_id: EXP_ID,
      activity_id: (e.payload['activity_id'] as string) ?? '',
      activity_code: (e.payload['activity_code'] as string) ?? '',
      activity_title: (e.payload['activity_title'] as string) ?? '',
      mapped_at: e.captured_at,
    },
  }));
}

// ---------------------------------------------------------------------------
// Chain 1: single MAPPED event
// ---------------------------------------------------------------------------
const chain1: MappingChainEvent[] = [
  {
    kind: 'EXPENDITURE_MAPPED',
    payload: {
      activity_id: 'a1',
      activity_code: 'CA-001',
      activity_title: 'Activity 1',
    },
    captured_at: '2026-05-01T00:00:00Z',
    id: 'e1',
  },
];

test('parity: chain 1 — single MAPPED event', () => {
  const serverOut = projectMapping(chain1);
  const clientOut = projectMappingFromEvents(toClientEvents(chain1));

  assert.ok(serverOut, 'server should return non-null');
  assert.equal(serverOut.kind, 'single');
  if (serverOut.kind === 'single') {
    const clientPayload = clientOut[EXP_ID];
    assert.ok(clientPayload, 'client should have entry for expenditure');
    assert.equal(serverOut.activity_id, clientPayload.activity_id);
    assert.equal(serverOut.activity_code, clientPayload.activity_code);
    assert.equal(serverOut.activity_title, clientPayload.activity_title);
  }
});

// ---------------------------------------------------------------------------
// Chain 2: two MAPPED events — latest wins
// ---------------------------------------------------------------------------
const chain2: MappingChainEvent[] = [
  {
    kind: 'EXPENDITURE_MAPPED',
    payload: {
      activity_id: 'a1',
      activity_code: 'CA-001',
      activity_title: 'Activity 1',
    },
    captured_at: '2026-05-01T00:00:00Z',
    id: 'e1',
  },
  {
    kind: 'EXPENDITURE_MAPPED',
    payload: {
      activity_id: 'a2',
      activity_code: 'CA-002',
      activity_title: 'Activity 2',
    },
    captured_at: '2026-05-02T00:00:00Z',
    id: 'e2',
  },
];

test('parity: chain 2 — two MAPPED events, latest wins', () => {
  const serverOut = projectMapping(chain2);
  const clientOut = projectMappingFromEvents(toClientEvents(chain2));

  assert.ok(serverOut);
  assert.equal(serverOut.kind, 'single');
  if (serverOut.kind === 'single') {
    const clientPayload = clientOut[EXP_ID];
    assert.ok(clientPayload);
    // Both should pick the second event (a2, CA-002).
    assert.equal(serverOut.activity_id, clientPayload.activity_id);
    assert.equal(serverOut.activity_id, 'a2');
  }
});

// ---------------------------------------------------------------------------
// Chain 3: MAPPED events with same captured_at — id tiebreaker
// ---------------------------------------------------------------------------
const chain3: MappingChainEvent[] = [
  {
    kind: 'EXPENDITURE_MAPPED',
    payload: {
      activity_id: 'a1',
      activity_code: 'CA-001',
      activity_title: 'A1',
    },
    captured_at: '2026-05-01T00:00:00Z',
    id: 'e1',
  },
  {
    kind: 'EXPENDITURE_MAPPED',
    payload: {
      activity_id: 'a3',
      activity_code: 'CA-003',
      activity_title: 'A3',
    },
    captured_at: '2026-05-01T00:00:00Z',
    id: 'e3',
  },
  {
    kind: 'EXPENDITURE_MAPPED',
    payload: {
      activity_id: 'a2',
      activity_code: 'CA-002',
      activity_title: 'A2',
    },
    captured_at: '2026-05-01T00:00:00Z',
    id: 'e2',
  },
];

test('parity: chain 3 — same captured_at, id tiebreaker', () => {
  const serverOut = projectMapping(chain3);
  const clientOut = projectMappingFromEvents(toClientEvents(chain3));

  assert.ok(serverOut);
  assert.equal(serverOut.kind, 'single');
  if (serverOut.kind === 'single') {
    const clientPayload = clientOut[EXP_ID];
    assert.ok(clientPayload);
    // Both should pick e3 (highest id at same instant).
    assert.equal(serverOut.activity_id, clientPayload.activity_id);
    assert.equal(serverOut.activity_id, 'a3');
  }
});
