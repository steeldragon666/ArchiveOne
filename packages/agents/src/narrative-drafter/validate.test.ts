import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSegment, type NarrativeSegment } from './validate.js';

// Sample event UUIDs (v4) used as fixtures. Picking literal values
// (rather than generating per-test) keeps reason-message assertions
// stable.
const EV_A = '11111111-1111-4111-8111-111111111111';
const EV_B = '22222222-2222-4222-8222-222222222222';
const EV_OUT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const inScope: ReadonlySet<string> = new Set([EV_A, EV_B]);

test('valid prose (no citing_events) → ok', () => {
  const seg: NarrativeSegment = { type: 'prose', text: 'Section 355-25 of the ITAA 1997...' };
  const result = validateSegment(seg, inScope);
  assert.deepEqual(result, { ok: true });
});

test('valid claim with one in-scope event → ok', () => {
  const seg: NarrativeSegment = {
    type: 'claim',
    text: 'On 3 March, the team replaced the bearing.',
    citing_events: [EV_A],
  };
  const result = validateSegment(seg, inScope);
  assert.deepEqual(result, { ok: true });
});

test('valid claim with multiple in-scope events → ok', () => {
  const seg: NarrativeSegment = {
    type: 'claim',
    text: 'Two iterations were attempted.',
    citing_events: [EV_A, EV_B],
  };
  const result = validateSegment(seg, inScope);
  assert.deepEqual(result, { ok: true });
});

test('claim missing citing_events (empty array) → fails with canonical reason', () => {
  // Bypass static narrowing: at runtime the model could emit an empty
  // citing_events array even though the Zod wire schema would reject
  // it (`.min(1)`). The validator must still catch this defensively.
  const seg = {
    type: 'claim',
    text: 'Something happened.',
    citing_events: [],
  } as unknown as NarrativeSegment;
  const result = validateSegment(seg, inScope);
  assert.deepEqual(result, { ok: false, reason: 'claim segment missing citing_events' });
});

test('claim missing citing_events (undefined) → fails with canonical reason', () => {
  // Same defensive path — the field is missing entirely.
  const seg = {
    type: 'claim',
    text: 'Something happened.',
  } as unknown as NarrativeSegment;
  const result = validateSegment(seg, inScope);
  assert.deepEqual(result, { ok: false, reason: 'claim segment missing citing_events' });
});

test('claim with one out-of-scope event → fails and names the offending id', () => {
  const seg: NarrativeSegment = {
    type: 'claim',
    text: 'Anchored to the wrong activity.',
    citing_events: [EV_OUT],
  };
  const result = validateSegment(seg, inScope);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /cites event .+ outside/);
    assert.ok(
      result.reason.includes(EV_OUT),
      `reason should mention the offending id ${EV_OUT}, got: ${result.reason}`,
    );
  }
});

test('claim with mix of in-scope and out-of-scope events → fails on the FIRST out-of-scope id', () => {
  const seg: NarrativeSegment = {
    type: 'claim',
    text: 'Mixed citations.',
    citing_events: [EV_A, EV_OUT, EV_B],
  };
  const result = validateSegment(seg, inScope);
  assert.equal(result.ok, false);
  if (!result.ok) {
    // EV_OUT is the first out-of-scope id; the reason should name it
    // (not EV_B, which also wouldn't be checked once we bail).
    assert.ok(
      result.reason.includes(EV_OUT),
      `reason should name the first failing id (${EV_OUT}), got: ${result.reason}`,
    );
    assert.match(result.reason, /outside this activity's clustered_events/);
  }
});

test('prose with unexpected citing_events → ok with soft warning (orchestrator soft-rejects)', () => {
  // Design choice: prose-with-citations returns { ok: true, warnings: [...] }
  // rather than failing. The spec says "warn but not fail — soft-rejected at
  // orchestrator level"; surfacing a warning lets the orchestrator (Task 5.4)
  // record it for telemetry without forcing the model into a retry loop over
  // a structurally harmless violation. The Zod wire schema (.strict()) would
  // already reject this upstream — the warning is a defence-in-depth signal.
  const seg = {
    type: 'prose',
    text: 'Definitional bridge.',
    citing_events: [EV_A],
  } as unknown as NarrativeSegment;
  const result = validateSegment(seg, inScope);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.warnings, 'expected warnings array');
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0]!, /unexpected citing_events/);
  }
});

test('empty clusteredEventIds set + valid-shape claim → fails (no event can be in scope)', () => {
  const empty: ReadonlySet<string> = new Set<string>();
  const seg: NarrativeSegment = {
    type: 'claim',
    text: 'Cannot anchor.',
    citing_events: [EV_A],
  };
  const result = validateSegment(seg, empty);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.reason.includes(EV_A));
    assert.match(result.reason, /outside/);
  }
});

test('validateSegment does not mutate clusteredEventIds', () => {
  const ids = new Set([EV_A, EV_B]);
  const sizeBefore = ids.size;
  const seg: NarrativeSegment = {
    type: 'claim',
    text: 'Pure check.',
    citing_events: [EV_A],
  };
  validateSegment(seg, ids);
  assert.equal(ids.size, sizeBefore);
  assert.ok(ids.has(EV_A));
  assert.ok(ids.has(EV_B));
});
