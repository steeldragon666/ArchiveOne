import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Event as ApiEvent } from '@cpa/schemas';
import { summariseEvent } from './summarise-event.js';

/**
 * Pure-function tests for the shared payload summariser (promoted from
 * register/_components/summarise-event.test.ts in T-A7).
 *
 * apps/web has no jsdom in its node:test runner, so any React-rendered
 * consumers (the register feed, the project-detail timeline tab) are
 * exercised end-to-end via Playwright in a later swimlane.
 *
 * Coverage:
 *   - Each of the six classifier kinds renders the truncated raw_text.
 *   - ACTIVITY_UPDATED renders the changed-field list.
 *   - PROJECT_CREATED renders the project name.
 *   - PROJECT_UPDATED renders the changed-field list.
 *   - PROJECT_ARCHIVED renders the optional reason or static label.
 *   - Unknown kinds fall back to the kind label.
 *   - Truncation kicks in at the cap.
 *   - Defensive paths (missing payload, hypothesis-prompt mobile
 *     variant) don't crash and return sensible fallbacks.
 */

const baseEvent = (overrides: Partial<ApiEvent> = {}): ApiEvent => ({
  id: '00000000-0000-4000-8000-000000a60001',
  tenant_id: '00000000-0000-4000-8000-000000a60100',
  subject_tenant_id: '00000000-0000-4000-8000-000000a60101',
  project_id: null,
  milestone_id: null,
  kind: 'HYPOTHESIS',
  effective_kind: 'HYPOTHESIS',
  is_overridden: false,
  payload: { _v: 1, source: 'paste', raw_text: 'We hypothesised the catalyst lasts 200 hours.' },
  classification: null,
  override_of_event_id: null,
  override_new_kind: null,
  override_reason: null,
  prev_hash: null,
  hash: 'a'.repeat(64),
  idempotency_key: null,
  captured_at: '2026-04-01T00:00:00.000Z',
  captured_by_user_id: '00000000-0000-4000-8000-000000a60010',
  received_at: '2026-04-01T00:00:00.000Z',
  ...overrides,
});

test('summariseEvent: HYPOTHESIS — returns the raw_text snippet', () => {
  const evt = baseEvent({ kind: 'HYPOTHESIS' });
  const out = summariseEvent(evt);
  assert.equal(out, 'We hypothesised the catalyst lasts 200 hours.');
});

test('summariseEvent: UNCERTAINTY — returns the raw_text snippet', () => {
  const evt = baseEvent({
    kind: 'UNCERTAINTY',
    payload: { _v: 1, source: 'paste', raw_text: 'Unsure whether the polymer cures uniformly.' },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'Unsure whether the polymer cures uniformly.');
});

test('summariseEvent: EXPERIMENT — returns the raw_text snippet', () => {
  const evt = baseEvent({
    kind: 'EXPERIMENT',
    payload: { _v: 1, source: 'paste', raw_text: 'Ran the cure cycle at 80°C for 4 hours.' },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'Ran the cure cycle at 80°C for 4 hours.');
});

test('summariseEvent: OBSERVATION — returns the raw_text snippet', () => {
  const evt = baseEvent({
    kind: 'OBSERVATION',
    payload: { _v: 1, source: 'paste', raw_text: 'Observed 12% reduction in tensile strength.' },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'Observed 12% reduction in tensile strength.');
});

test('summariseEvent: ITERATION — returns the raw_text snippet', () => {
  const evt = baseEvent({
    kind: 'ITERATION',
    payload: { _v: 1, source: 'paste', raw_text: 'Adjusted catalyst loading to 1.5%.' },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'Adjusted catalyst loading to 1.5%.');
});

test('summariseEvent: NEW_KNOWLEDGE — returns the raw_text snippet', () => {
  const evt = baseEvent({
    kind: 'NEW_KNOWLEDGE',
    payload: {
      _v: 1,
      source: 'paste',
      raw_text: 'New finding: the cure cycle window is narrower than the literature suggests.',
    },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'New finding: the cure cycle window is narrower than the literature suggests.');
});

test('summariseEvent: ACTIVITY_UPDATED — names the changed fields', () => {
  const evt = baseEvent({
    kind: 'ACTIVITY_UPDATED',
    payload: {
      activity_id: '00000000-0000-4000-8000-000000a60020',
      fields_changed: {
        hypothesis: { from: null, to: 'New hypothesis' },
        technical_uncertainty: { from: 'old', to: 'new' },
      },
    },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'Updated: hypothesis, technical_uncertainty');
});

test('summariseEvent: ACTIVITY_UPDATED with no fields_changed falls back', () => {
  const evt = baseEvent({
    kind: 'ACTIVITY_UPDATED',
    payload: { activity_id: '00000000-0000-4000-8000-000000a60020' },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'Activity updated');
});

test('summariseEvent: PROJECT_CREATED — uses project name', () => {
  const evt = baseEvent({
    kind: 'PROJECT_CREATED',
    payload: {
      project_id: '00000000-0000-4000-8000-000000a70030',
      name: 'Catalyst Stability Study',
      started_at: '2026-04-01T00:00:00.000Z',
    },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'Project created: Catalyst Stability Study');
});

test('summariseEvent: PROJECT_CREATED missing name falls back to label', () => {
  const evt = baseEvent({
    kind: 'PROJECT_CREATED',
    payload: { project_id: '00000000-0000-4000-8000-000000a70030' },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'Project created');
});

test('summariseEvent: PROJECT_UPDATED — names the changed fields', () => {
  const evt = baseEvent({
    kind: 'PROJECT_UPDATED',
    payload: {
      project_id: '00000000-0000-4000-8000-000000a70030',
      fields_changed: {
        name: { from: 'old', to: 'new' },
        started_at: { from: '2026-04-01T00:00:00.000Z', to: '2026-04-15T00:00:00.000Z' },
      },
    },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'Updated: name, started_at');
});

test('summariseEvent: PROJECT_UPDATED with no fields_changed falls back', () => {
  const evt = baseEvent({
    kind: 'PROJECT_UPDATED',
    payload: { project_id: '00000000-0000-4000-8000-000000a70030' },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'Project updated');
});

test('summariseEvent: PROJECT_ARCHIVED — uses reason when present', () => {
  const evt = baseEvent({
    kind: 'PROJECT_ARCHIVED',
    payload: {
      project_id: '00000000-0000-4000-8000-000000a70030',
      archived_by_user_id: '00000000-0000-4000-8000-000000a70010',
      reason: 'Project superseded by 2027 follow-up engagement.',
    },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'Project archived: Project superseded by 2027 follow-up engagement.');
});

test('summariseEvent: PROJECT_ARCHIVED without reason falls back to label', () => {
  const evt = baseEvent({
    kind: 'PROJECT_ARCHIVED',
    payload: {
      project_id: '00000000-0000-4000-8000-000000a70030',
      archived_by_user_id: '00000000-0000-4000-8000-000000a70010',
    },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'Project archived');
});

test('summariseEvent: unknown kind falls back to the kind label', () => {
  const evt = baseEvent({
    kind: 'ARTEFACT_LINKED',
    effective_kind: 'ARTEFACT_LINKED',
    payload: { activity_id: 'a', artefact_kind: 'media', artefact_id: 'b' },
  });
  const out = summariseEvent(evt);
  // Falls through to the `default` branch — kind label is the safe
  // fallback for anything outside the supported set.
  assert.equal(out, 'ARTEFACT_LINKED');
});

test('summariseEvent: truncates long raw_text with ellipsis', () => {
  const long = 'x'.repeat(500);
  const evt = baseEvent({
    kind: 'HYPOTHESIS',
    payload: { _v: 1, source: 'paste', raw_text: long },
  });
  const out = summariseEvent(evt);
  assert.ok(out.length <= 200, `expected length ≤ 200, got ${out.length}`);
  assert.ok(out.endsWith('…'), 'expected truncation ellipsis');
});

test('summariseEvent: hypothesis-prompt mobile variant uses predicted_outcome', () => {
  // Mobile hypothesis-prompt path emits a structured payload — no
  // raw_text. The summariser falls through to predicted_outcome.
  const evt = baseEvent({
    kind: 'HYPOTHESIS',
    payload: {
      _v: 1,
      source: 'hypothesis_prompt',
      predicted_outcome: 'Catalyst will last 200 hours.',
      success_criteria: '< 5% drop',
      uncertainty: 'Long-term thermal stability',
    },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'Catalyst will last 200 hours.');
});

test('summariseEvent: missing payload falls back to classification rationale', () => {
  const evt = baseEvent({
    kind: 'HYPOTHESIS',
    payload: { _v: 1, source: 'paste' }, // no raw_text
    classification: {
      kind: 'HYPOTHESIS',
      confidence: 0.9,
      rationale: 'Statement frames a testable prediction.',
      statutory_anchor: 's355-25(1)',
      model: 'stub',
      prompt_version: 'classify@1.0.0',
      tokens_in: 0,
      tokens_out: 0,
    },
  });
  const out = summariseEvent(evt);
  assert.equal(out, 'Statement frames a testable prediction.');
});
