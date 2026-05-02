/**
 * Tests for POST /v1/activities/:id/narrative (Task 5.5).
 *
 * Mocking strategy mirrors `narrative-drafter/stream.test.ts`:
 * inject a stub Anthropic streaming client via
 * `_setStreamingClientForTests` so the orchestrator yields a
 * deterministic sequence of segments without touching the network.
 *
 * SSE-response parsing: `app.inject()` returns the full reply body
 * once `reply.raw.end()` runs. We can read the raw text and split
 * into `event: X\ndata: {...}\n\n` blocks for assertion. inject()
 * does NOT simulate client disconnects (no real socket close), so
 * the abort test exercises the listener-wiring contract by calling
 * the abort path through the same surface area.
 */

import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { signSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { insertEventWithChain } from '@cpa/db';
import { _reloadEnvForTests } from '@cpa/agents/runtime';
import { _setStreamingClientForTests, type SectionKind } from '@cpa/agents/narrative-drafter';
import type { ActivityRegisterDraftedPayload, ProposedActivity } from '@cpa/schemas';
import { buildApp } from '../app.js';

// Default-on flags so the route isn't 503'd by stale env from another file.
delete process.env.P6_AGENT_C_ENABLED;
delete process.env.P6_AGENT_TENANT_ALLOWLIST;
_reloadEnvForTests();

const SESSION_SECRET = process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';

// Theme C / Task 5.5 — UUID prefix `c55` keeps fixtures disjoint from
// other route tests' tenants (4400 / 4500 / etc.).
const TENANT_A = '00000000-0000-4000-8000-0000000c5500';
const TENANT_B = '00000000-0000-4000-8000-0000000c5501';
const ADMIN_USER = '00000000-0000-4000-8000-0000000c5510';
const VIEWER_USER = '00000000-0000-4000-8000-0000000c5511';
const CONSULTANT_USER = '00000000-0000-4000-8000-0000000c5512';
const SUBJECT_A = '00000000-0000-4000-8000-0000000c5520';
const PROJECT_A = '00000000-0000-4000-8000-0000000c5530';
const CLAIM_A = '00000000-0000-4000-8000-0000000c5540';

// Agent B system user — used as captured_by_user_id when seeding the
// register-drafted event. Migration 0033 seeds it; we INSERT
// idempotently in `before` for fresh-DB runs.
const AGENT_B_SYSTEM_USER_ID = '00000000-0000-4000-8000-000000a90002';

// ---------------------------------------------------------------------------
// Fixtures: an activity with a proposed_id correlation back through
// ACTIVITY_REGISTER_DRAFTED → clustered_event_ids → 3 evidence events
// with payload.text. Each test reuses these; per-test isolation drops
// the narrative_draft + NARRATIVE_DRAFTED rows that the route writes.
// ---------------------------------------------------------------------------

const cleanupRows = async (): Promise<void> => {
  await privilegedSql`DELETE FROM narrative_draft_version WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM narrative_draft WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM event WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM activity WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM claim WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM project WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM subject_tenant WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await sql`DELETE FROM "user" WHERE id IN (${ADMIN_USER}, ${VIEWER_USER}, ${CONSULTANT_USER})`;
  await sql`DELETE FROM tenant WHERE id IN (${TENANT_A}, ${TENANT_B})`;
};

before(async () => {
  await cleanupRows();
  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT_A}, 'Firm C55A', 'firm-c55a', 'mixed'),
                   (${TENANT_B}, 'Firm C55B', 'firm-c55b', 'mixed')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${ADMIN_USER}, 'c55-admin@example.com', 'microsoft', 'microsoft:c55-admin', 'C55 Admin'),
                   (${VIEWER_USER}, 'c55-viewer@example.com', 'microsoft', 'microsoft:c55-viewer', 'C55 Viewer'),
                   (${CONSULTANT_USER}, 'c55-cons@example.com', 'microsoft', 'microsoft:c55-cons', 'C55 Consultant')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${AGENT_B_SYSTEM_USER_ID}, 'system+agent-b@cpa.local', 'microsoft', 'system:agent-b', 'Agent B (Activity Register Synthesizer)')
            ON CONFLICT (id) DO NOTHING`;
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_A}, ${ADMIN_USER}, 'admin', true),
                              (gen_random_uuid(), ${TENANT_A}, ${VIEWER_USER}, 'viewer', true),
                              (gen_random_uuid(), ${TENANT_A}, ${CONSULTANT_USER}, 'consultant', true)`;
  await privilegedSql`INSERT INTO subject_tenant (id, tenant_id, name, kind)
                       VALUES (${SUBJECT_A}, ${TENANT_A}, 'C55 Subject A', 'claimant')`;
  await privilegedSql`
    INSERT INTO project (id, tenant_id, subject_tenant_id, name, started_at)
    VALUES (${PROJECT_A}, ${TENANT_A}, ${SUBJECT_A}, 'C55 Project A',
            '2024-07-01T00:00:00Z'::timestamptz)
  `;
  await privilegedSql`
    INSERT INTO claim (id, tenant_id, subject_tenant_id, project_id, fiscal_year, stage)
    VALUES (${CLAIM_A}, ${TENANT_A}, ${SUBJECT_A}, ${PROJECT_A}, 2025, 'engagement')
  `;
});

after(async () => {
  await cleanupRows();
  await sql.end();
  await privilegedSql.end();
});

beforeEach(async () => {
  await privilegedSql`DELETE FROM narrative_draft_version WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM narrative_draft WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM event WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM activity WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  delete process.env.P6_AGENT_C_ENABLED;
  delete process.env.P6_AGENT_TENANT_ALLOWLIST;
  _reloadEnvForTests();
  _setStreamingClientForTests(null);
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

const jwtFor = (
  userId: string,
  email: string,
  role: 'admin' | 'consultant' | 'viewer',
  tenantId: string = TENANT_A,
): Promise<string> =>
  signSession(
    {
      sub: userId,
      email,
      primaryIdp: 'microsoft',
      activeTenantId: tenantId,
      activeRole: role,
      availableTenants: [],
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );

const _adminJwt = (): Promise<string> => jwtFor(ADMIN_USER, 'c55-admin@example.com', 'admin');
void _adminJwt; // reserved for future tests; keeps the lint allowlist happy.
const viewerJwt = (): Promise<string> => jwtFor(VIEWER_USER, 'c55-viewer@example.com', 'viewer');
const consultantJwt = (): Promise<string> =>
  jwtFor(CONSULTANT_USER, 'c55-cons@example.com', 'consultant');

// ---------------------------------------------------------------------------
// Helpers — seed an activity with the chain history Agent C needs to
// derive `clustered_event_ids` from `ACTIVITY_REGISTER_DRAFTED`.
// ---------------------------------------------------------------------------

/**
 * Seed:
 *   - 3 evidence events with payload.text (the clustered_event_ids set)
 *   - 1 ACTIVITY_REGISTER_DRAFTED event listing one ProposedActivity
 *     whose clustered_event_ids point at those 3 evidence events
 *   - 1 activity row + 1 ACTIVITY_CREATED event with proposed_id = the
 *     ProposedActivity's id
 *
 * Returns the activity's id and the 3 event ids so tests can assert on
 * them. Each invocation generates fresh ids so per-test isolation holds.
 */
async function seedActivityWithCluster(args: {
  tenantId?: string;
  projectId?: string;
  subjectTenantId?: string;
  claimId?: string;
}): Promise<{
  activityId: string;
  proposedId: string;
  evidenceEventIds: string[];
}> {
  const tenantId = args.tenantId ?? TENANT_A;
  const projectId = args.projectId ?? PROJECT_A;
  const subjectTenantId = args.subjectTenantId ?? SUBJECT_A;
  const claimId = args.claimId ?? CLAIM_A;
  const activityId = crypto.randomUUID();
  const proposedId = crypto.randomUUID();

  // 1) evidence events
  const evidenceEventIds: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const evtId = crypto.randomUUID();
    await insertEventWithChain({
      tenant_id: tenantId,
      subject_tenant_id: subjectTenantId,
      project_id: projectId,
      kind: 'EXPERIMENT',
      payload: {
        _v: 1,
        text: `Evidence sample ${i} — recorded experiment of length 50 words or so.`,
      },
      classification: null,
      captured_at: new Date(`2025-01-0${i + 1}T00:00:00Z`),
      captured_by_user_id: CONSULTANT_USER,
      override_of_event_id: null,
      override_new_kind: null,
      override_reason: null,
    });
    // We need the actual id from the chain insert; refetch the latest
    // EXPERIMENT for this project to capture it (insertEventWithChain
    // returns it but we already discarded — recover via the most-recent
    // matching row).
    const rows = await privilegedSql<{ id: string }[]>`
      SELECT id FROM event
       WHERE project_id = ${projectId}
         AND kind = 'EXPERIMENT'
       ORDER BY captured_at DESC, received_at DESC, id DESC
       LIMIT 1
    `;
    void evtId;
    evidenceEventIds.push(rows[0]!.id);
  }

  // 2) ACTIVITY_REGISTER_DRAFTED with proposed activity citing those events
  const proposed: ProposedActivity = {
    proposed_id: proposedId,
    name: 'Proposed activity',
    kind: 'core',
    statutory_anchor: 's.355-25',
    rationale: 'covers the experimental backbone',
    clustered_event_ids: evidenceEventIds,
    confidence: 0.9,
    proposed_hypothesis: null,
    proposed_uncertainty: null,
  };
  const draftPayload: ActivityRegisterDraftedPayload = {
    _v: 1,
    project_id: projectId,
    proposed_activities: [proposed],
    unclustered_event_ids: [],
    total_input_events: evidenceEventIds.length,
    events_truncated: false,
    synthesizer_notes: 'test seed',
    model: 'test-stub',
    prompt_version: 'synthesize-register@1.0.0',
    idempotency_key: crypto
      .createHash('sha256')
      .update(`c55-seed-${projectId}-${proposedId}`)
      .digest('hex'),
  };
  await insertEventWithChain({
    tenant_id: tenantId,
    subject_tenant_id: subjectTenantId,
    project_id: projectId,
    kind: 'ACTIVITY_REGISTER_DRAFTED',
    payload: draftPayload,
    classification: null,
    captured_at: new Date(),
    captured_by_user_id: AGENT_B_SYSTEM_USER_ID,
    override_of_event_id: null,
    override_new_kind: null,
    override_reason: null,
    idempotency_key: draftPayload.idempotency_key,
  });

  // 3) activity row + ACTIVITY_CREATED event with proposed_id correlation
  await privilegedSql`
    INSERT INTO activity (id, tenant_id, project_id, claim_id, code, kind, title)
    VALUES (${activityId}, ${tenantId}, ${projectId}, ${claimId}, 'CA-01', 'core', 'Activity under test')
  `;
  await insertEventWithChain({
    tenant_id: tenantId,
    subject_tenant_id: subjectTenantId,
    project_id: projectId,
    kind: 'ACTIVITY_CREATED',
    payload: {
      _v: 1,
      activity_id: activityId,
      code: 'CA-01',
      kind: 'core',
      title: 'Activity under test',
      project_id: projectId,
      claim_id: claimId,
      proposed_id: proposedId,
    },
    classification: null,
    captured_at: new Date(),
    captured_by_user_id: CONSULTANT_USER,
    override_of_event_id: null,
    override_new_kind: null,
    override_reason: null,
  });

  return { activityId, proposedId, evidenceEventIds };
}

/** Seed an activity with NO proposed_id (manually created — no Agent B trail). */
async function seedActivityWithoutProposedId(): Promise<string> {
  const activityId = crypto.randomUUID();
  await privilegedSql`
    INSERT INTO activity (id, tenant_id, project_id, claim_id, code, kind, title)
    VALUES (${activityId}, ${TENANT_A}, ${PROJECT_A}, ${CLAIM_A}, 'CA-99', 'core', 'No-history activity')
  `;
  return activityId;
}

// ---------------------------------------------------------------------------
// Stub Anthropic streaming client — minimal version of the helper from
// `stream.test.ts`. Returns a single turn that emits one segment per
// supplied entry as an `emit_segment` tool_use block.
// ---------------------------------------------------------------------------

type SegmentEmit = {
  section_kind: SectionKind;
  segment_index: number;
} & ({ type: 'prose'; text: string } | { type: 'claim'; text: string; citing_events: string[] });

let stubBlockId = 1;

function buildTurnEvents(segments: SegmentEmit[]): Anthropic.MessageStreamEvent[] {
  const events: Anthropic.MessageStreamEvent[] = [];
  events.push({
    type: 'message_start',
    message: {
      id: `msg_${String(stubBlockId++)}`,
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-sonnet-4-5',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 0 },
    },
  });
  segments.forEach((seg, i) => {
    const id = `tu_${String(stubBlockId++)}`;
    events.push({
      type: 'content_block_start',
      index: i,
      content_block: { type: 'tool_use', id, name: 'emit_segment', input: {} },
    });
    events.push({
      type: 'content_block_delta',
      index: i,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(seg) },
    });
    events.push({ type: 'content_block_stop', index: i });
  });
  events.push({
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 200 },
  });
  events.push({ type: 'message_stop' });
  return events;
}

function makeStubClient(
  turns: Anthropic.MessageStreamEvent[][],
): Parameters<typeof _setStreamingClientForTests>[0] {
  let cursor = 0;
  return {
    messages: {
      stream() {
        const turn = turns[cursor++];
        if (!turn) {
          throw new Error(`stub ran out of turns (called ${cursor} times)`);
        }
        return {
          async *[Symbol.asyncIterator]() {
            await Promise.resolve();
            for (const ev of turn) yield ev;
          },
        };
      },
    },
  };
}

/**
 * Standard happy-path stub — emits two segments per section across all
 * four sections (8 total, 4 of them claims). Each claim cites at least
 * one event from the seeded `evidenceEventIds`.
 */
function happyPathStub(
  evidenceEventIds: string[],
): Parameters<typeof _setStreamingClientForTests>[0] {
  const sections: SectionKind[] = [
    'new_knowledge',
    'hypothesis',
    'uncertainty',
    'experiments_and_results',
  ];
  const segments: SegmentEmit[] = [];
  sections.forEach((sk) => {
    segments.push({
      section_kind: sk,
      segment_index: 0,
      type: 'prose',
      text: `Prose intro for ${sk}.`,
    });
    segments.push({
      section_kind: sk,
      segment_index: 1,
      type: 'claim',
      text: `Claim for ${sk}.`,
      citing_events: [evidenceEventIds[0]!],
    });
  });
  return makeStubClient([buildTurnEvents(segments)]);
}

/**
 * Parse the SSE response body into a list of `{ event, data }` blocks.
 * The wire format is `event: <name>\ndata: <json>\n\n` per event.
 */
function parseSSE(body: string): Array<{ event: string; data: unknown }> {
  if (body === '') return [];
  const out: Array<{ event: string; data: unknown }> = [];
  for (const block of body.split('\n\n')) {
    const trimmed = block.trim();
    if (trimmed === '') continue;
    const lines = trimmed.split('\n');
    let event = '';
    let dataStr = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice('event: '.length);
      else if (line.startsWith('data: ')) dataStr = line.slice('data: '.length);
    }
    out.push({ event, data: dataStr === '' ? null : JSON.parse(dataStr) });
  }
  return out;
}

// ===========================================================================
// Tests
// ===========================================================================

test('POST narrative: 401 without session', async () => {
  const app = buildApp();
  const { activityId } = await seedActivityWithCluster({});
  const res = await app.inject({
    method: 'POST',
    url: `/v1/activities/${activityId}/narrative`,
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('POST narrative: 403 for viewer role', async () => {
  const app = buildApp();
  const { activityId } = await seedActivityWithCluster({});
  const res = await app.inject({
    method: 'POST',
    url: `/v1/activities/${activityId}/narrative`,
    cookies: { cpa_session: await viewerJwt() },
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test('POST narrative: 503 when P6_AGENT_C_ENABLED=false', async () => {
  process.env.P6_AGENT_C_ENABLED = 'false';
  _reloadEnvForTests();
  try {
    const app = buildApp();
    const { activityId } = await seedActivityWithCluster({});
    const res = await app.inject({
      method: 'POST',
      url: `/v1/activities/${activityId}/narrative`,
      cookies: { cpa_session: await consultantJwt() },
    });
    assert.equal(res.statusCode, 503);
    const body = res.json<{ error: string }>();
    assert.equal(body.error, 'feature_disabled');
    await app.close();
  } finally {
    delete process.env.P6_AGENT_C_ENABLED;
    _reloadEnvForTests();
  }
});

test('POST narrative: 400 on activity with no proposed_id (no clustered_events)', async () => {
  const activityId = await seedActivityWithoutProposedId();
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/activities/${activityId}/narrative`,
    cookies: { cpa_session: await consultantJwt() },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'no_clustered_events');
  await app.close();
});

test('POST narrative: 404 for unknown activity', async () => {
  const app = buildApp();
  const unknown = '00000000-0000-4000-8000-0000000c55ff';
  const res = await app.inject({
    method: 'POST',
    url: `/v1/activities/${unknown}/narrative`,
    cookies: { cpa_session: await consultantJwt() },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('POST narrative: 200 happy path — 4 narrative_draft + 4 narrative_draft_version + 4 NARRATIVE_DRAFTED events', async () => {
  const { activityId, evidenceEventIds } = await seedActivityWithCluster({});
  _setStreamingClientForTests(happyPathStub(evidenceEventIds));

  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/activities/${activityId}/narrative`,
    cookies: { cpa_session: await consultantJwt() },
    payload: {},
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/event-stream');

  const events = parseSSE(res.body);
  // Tally event types we care about.
  const segmentEvents = events.filter((e) => e.event === 'segment');
  const sectionCompleteEvents = events.filter((e) => e.event === 'section_complete');
  const doneEvents = events.filter((e) => e.event === 'done');
  const errorEvents = events.filter((e) => e.event === 'error');

  assert.equal(errorEvents.length, 0, 'no error events on happy path');
  assert.equal(segmentEvents.length, 8, '2 segments × 4 sections');
  assert.equal(sectionCompleteEvents.length, 4, 'one section_complete per section');
  assert.equal(doneEvents.length, 1, 'exactly one done event');

  const done = doneEvents[0]!.data as {
    idempotent: boolean;
    draft_id: string;
    narrative_drafted_event_id: string;
    total_segments: number;
    total_claims: number;
  };
  assert.equal(done.idempotent, false);
  assert.ok(done.draft_id, 'draft_id present');
  assert.ok(done.narrative_drafted_event_id, 'narrative_drafted_event_id present');
  assert.equal(done.total_segments, 8);
  assert.equal(done.total_claims, 4);

  // 4 narrative_draft rows
  const draftRows = await privilegedSql<
    { section_kind: string; current_version: number; status: string; content_hash: string }[]
  >`
    SELECT section_kind, current_version, status, content_hash
      FROM narrative_draft
     WHERE tenant_id = ${TENANT_A} AND activity_id = ${activityId}
     ORDER BY section_kind
  `;
  assert.equal(draftRows.length, 4);
  draftRows.forEach((r) => {
    assert.equal(r.current_version, 1);
    assert.equal(r.status, 'complete');
    assert.match(r.content_hash, /^[a-f0-9]{64}$/);
  });

  // 4 narrative_draft_version rows
  const versionRows = await privilegedSql<
    { version: number; generation_kind: string; parent_version: number | null }[]
  >`
    SELECT v.version, v.generation_kind, v.parent_version
      FROM narrative_draft_version v
      JOIN narrative_draft d ON d.id = v.draft_id AND d.tenant_id = v.tenant_id
     WHERE d.activity_id = ${activityId}
       AND d.tenant_id = ${TENANT_A}
  `;
  assert.equal(versionRows.length, 4);
  versionRows.forEach((r) => {
    assert.equal(r.version, 1);
    assert.equal(r.generation_kind, 'initial');
    assert.equal(r.parent_version, null);
  });

  // 4 NARRATIVE_DRAFTED chain events
  const eventRows = await privilegedSql<
    { payload: { activity_id: string; section_kind: string; version: number } }[]
  >`
    SELECT payload FROM event
     WHERE tenant_id = ${TENANT_A}
       AND kind = 'NARRATIVE_DRAFTED'
       AND (payload ->> 'activity_id') = ${activityId}
  `;
  assert.equal(eventRows.length, 4);
  const sectionKinds = eventRows.map((r) => r.payload.section_kind).sort();
  assert.deepEqual(sectionKinds, [
    'experiments_and_results',
    'hypothesis',
    'new_knowledge',
    'uncertainty',
  ]);

  await app.close();
});

test('POST narrative: idempotent retry with same client_request_id returns single done event', async () => {
  const { activityId, evidenceEventIds } = await seedActivityWithCluster({});
  _setStreamingClientForTests(happyPathStub(evidenceEventIds));
  const clientRequestId = `req-${crypto.randomUUID()}`;

  const app = buildApp();
  const first = await app.inject({
    method: 'POST',
    url: `/v1/activities/${activityId}/narrative`,
    cookies: { cpa_session: await consultantJwt() },
    payload: { client_request_id: clientRequestId },
  });
  assert.equal(first.statusCode, 200);
  const firstEvents = parseSSE(first.body);
  assert.ok(
    firstEvents.some((e) => e.event === 'segment'),
    'first call streams segments',
  );
  const firstDone = firstEvents.find((e) => e.event === 'done')!.data as {
    idempotent: boolean;
    draft_id: string;
  };
  assert.equal(firstDone.idempotent, false);

  // Second call with same client_request_id — even though we don't
  // restock the stub turns, the route should short-circuit BEFORE
  // calling the orchestrator. (If it didn't, the stub would throw
  // "ran out of turns" and we'd fail.)
  const second = await app.inject({
    method: 'POST',
    url: `/v1/activities/${activityId}/narrative`,
    cookies: { cpa_session: await consultantJwt() },
    payload: { client_request_id: clientRequestId },
  });
  assert.equal(second.statusCode, 200);
  const secondEvents = parseSSE(second.body);
  // Single `done` event, marked idempotent.
  assert.equal(secondEvents.length, 1);
  assert.equal(secondEvents[0]!.event, 'done');
  const secondDone = secondEvents[0]!.data as { idempotent: boolean; draft_id: string };
  assert.equal(secondDone.idempotent, true);
  assert.equal(secondDone.draft_id, firstDone.draft_id);

  // Persistence assertion: still exactly 4 narrative_draft rows.
  const rows = await privilegedSql<{ id: string }[]>`
    SELECT id FROM narrative_draft WHERE activity_id = ${activityId} AND tenant_id = ${TENANT_A}
  `;
  assert.equal(rows.length, 4);

  await app.close();
});

test('POST narrative: client abort mid-stream → no narrative_draft rows persisted', async () => {
  // Simulating a real client disconnect through `app.inject()` is
  // impossible (its light-my-request transport doesn't emit socket
  // 'close' the way a TCP socket does). Instead, we exploit the
  // orchestrator's parallel abort path: a stub that throws
  // `AbortError` mid-stream produces the SAME yield sequence the
  // orchestrator emits on a real abort (single `error` event with
  // `reason: 'aborted'`, no `done`). This exercises the route's
  // "no-persistence-on-error" branch — which is the same branch the
  // close-listener takes when the real socket aborts.
  const { activityId } = await seedActivityWithCluster({});
  const abortStub: Parameters<typeof _setStreamingClientForTests>[0] = {
    messages: {
      stream() {
        return {
          async *[Symbol.asyncIterator]() {
            await Promise.resolve();
            yield {
              type: 'message_start',
              message: {
                id: 'msg_a',
                type: 'message',
                role: 'assistant',
                content: [],
                model: 'claude-sonnet-4-5',
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 0 },
              },
            };
            const err = new Error('Aborted');
            err.name = 'AbortError';
            throw err;
          },
        };
      },
    },
  };
  _setStreamingClientForTests(abortStub);

  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/activities/${activityId}/narrative`,
    cookies: { cpa_session: await consultantJwt() },
    payload: {},
  });
  assert.equal(res.statusCode, 200);
  const events = parseSSE(res.body);
  // The orchestrator surfaces aborts as `error` (not `done`); the
  // route forwards the error frame and skips persistence.
  const errors = events.filter((e) => e.event === 'error');
  const dones = events.filter((e) => e.event === 'done');
  assert.equal(errors.length, 1);
  assert.equal(dones.length, 0);
  const errData = errors[0]!.data as { reason: string };
  assert.match(errData.reason, /abort/i);

  // Critically: NO narrative_draft rows persisted.
  const draftRows = await privilegedSql<{ id: string }[]>`
    SELECT id FROM narrative_draft WHERE activity_id = ${activityId} AND tenant_id = ${TENANT_A}
  `;
  assert.equal(draftRows.length, 0);

  await app.close();
});

test('POST narrative: orchestrator error mid-stream → SSE error event, no persistence', async () => {
  const { activityId } = await seedActivityWithCluster({});
  // Stub that throws a 5xx-shaped error after message_start. Mirrors the
  // mid-stream failure case in `stream.test.ts`.
  const errStub: Parameters<typeof _setStreamingClientForTests>[0] = {
    messages: {
      stream() {
        return {
          async *[Symbol.asyncIterator]() {
            await Promise.resolve();
            yield {
              type: 'message_start',
              message: {
                id: 'msg_x',
                type: 'message',
                role: 'assistant',
                content: [],
                model: 'claude-sonnet-4-5',
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 0 },
              },
            };
            const err: Error & { status?: number } = new Error('upstream boom');
            err.status = 500;
            throw err;
          },
        };
      },
    },
  };
  _setStreamingClientForTests(errStub);

  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/activities/${activityId}/narrative`,
    cookies: { cpa_session: await consultantJwt() },
    payload: {},
  });
  assert.equal(res.statusCode, 200); // SSE response started OK
  const events = parseSSE(res.body);
  const errors = events.filter((e) => e.event === 'error');
  const dones = events.filter((e) => e.event === 'done');
  assert.equal(errors.length, 1, 'exactly one error event');
  assert.equal(dones.length, 0, 'no done event when stream errored');

  // No narrative_draft rows persisted.
  const rows = await privilegedSql<{ id: string }[]>`
    SELECT id FROM narrative_draft WHERE activity_id = ${activityId} AND tenant_id = ${TENANT_A}
  `;
  assert.equal(rows.length, 0);

  // No NARRATIVE_DRAFTED events emitted.
  const evRows = await privilegedSql<{ id: string }[]>`
    SELECT id FROM event
     WHERE kind = 'NARRATIVE_DRAFTED'
       AND (payload ->> 'activity_id') = ${activityId}
  `;
  assert.equal(evRows.length, 0);

  await app.close();
});
