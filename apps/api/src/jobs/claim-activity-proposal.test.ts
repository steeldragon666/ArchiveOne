import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sql, privilegedSql } from '@cpa/db/client';
import { insertEventWithChain } from '@cpa/db';
import { _reloadEnvForTests } from '@cpa/agents/runtime';

// Force the stub synthesizer impl before the job module loads.
process.env.ACTIVITY_REGISTER_SYNTHESIZER_IMPL = 'stub';

// Default-on flags for happy paths. Per-test overrides reload via
// _reloadEnvForTests after mutating process.env.
delete process.env.P6_AGENT_B_ENABLED;
delete process.env.P6_AGENT_TENANT_ALLOWLIST;
_reloadEnvForTests();

// Import AFTER env is configured.
const { AGENT_B_SYSTEM_USER_ID } = await import('./activity-register-synthesize.js');
const { runClaimActivityProposalJob } = await import('./claim-activity-proposal.js');

// ---------------------------------------------------------------------------
// Pinned UUIDs — `0c31` segment groups all Task 3.1 fixtures.
// ---------------------------------------------------------------------------

const TENANT = '00000000-0000-4000-8000-0000000c3101';
const ADMIN_USER = '00000000-0000-4000-8000-0000000c3110';
const SUBJECT = '00000000-0000-4000-8000-0000000c3120';
const PROJECT = '00000000-0000-4000-8000-0000000c3130';
const CLAIM = '00000000-0000-4000-8000-0000000c3140';
const CLAIM_NO_WORKFLOW = '00000000-0000-4000-8000-0000000c3141';

const cleanup = async (): Promise<void> => {
  await privilegedSql`DELETE FROM agent_call_cache WHERE agent_name = 'activity-register-synthesizer'`;
  await privilegedSql`DELETE FROM event WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM audit_score_snapshot WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM activity WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM claim WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM project WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM subject_tenant WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT}`;
  await sql`DELETE FROM "user" WHERE id = ${ADMIN_USER}`;
  await sql`DELETE FROM tenant WHERE id = ${TENANT}`;
};

before(async () => {
  await cleanup();

  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT}, 'Firm C31', 'firm-c31', 'mixed')`;

  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${ADMIN_USER}, 'c31-admin@example.com', 'microsoft', 'microsoft:c31-admin', 'C31 Admin')`;

  // Seed AGENT_B_SYSTEM_USER_ID idempotently (seeded by migration 0033;
  // belt-and-braces guard so the test also runs on fresh DBs).
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${AGENT_B_SYSTEM_USER_ID}, 'system+agent-b@cpa.local', 'microsoft', 'system:agent-b', 'Agent B (Activity Register Synthesizer)')
            ON CONFLICT (id) DO NOTHING`;

  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT}, ${ADMIN_USER}, 'admin', true)`;

  await privilegedSql`INSERT INTO subject_tenant (id, tenant_id, name, kind)
                       VALUES (${SUBJECT}, ${TENANT}, 'Acme R&D C31', 'claimant')`;

  await privilegedSql`INSERT INTO project (id, tenant_id, subject_tenant_id, name, started_at)
                       VALUES (${PROJECT}, ${TENANT}, ${SUBJECT}, 'ML Pipeline Rebuild C31', '2024-07-01T00:00:00Z')`;

  // Main test claim with workflow_state set (initialized wizard).
  const workflowState = JSON.stringify({
    initialized_at: new Date().toISOString(),
    steps: { '1': null, '2': null, '3': null, '4': null, '5': null },
  });
  await privilegedSql`INSERT INTO claim (id, tenant_id, subject_tenant_id, project_id, fiscal_year, stage, workflow_state)
                       VALUES (${CLAIM}, ${TENANT}, ${SUBJECT}, ${PROJECT}, 2025, 'engagement', ${workflowState}::text::jsonb)`;

  // Claim without workflow_state (pre-wizard "legacy" claim).
  await privilegedSql`INSERT INTO claim (id, tenant_id, subject_tenant_id, project_id, fiscal_year, stage)
                       VALUES (${CLAIM_NO_WORKFLOW}, ${TENANT}, ${SUBJECT}, ${PROJECT}, 2026, 'engagement')`;
});

// Per-test isolation: clear events + cache, reset feature flags.
beforeEach(async () => {
  await privilegedSql`DELETE FROM event WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM agent_call_cache WHERE agent_name = 'activity-register-synthesizer'`;
  delete process.env.P6_AGENT_B_ENABLED;
  delete process.env.P6_AGENT_TENANT_ALLOWLIST;
  _reloadEnvForTests();
});

after(async () => {
  await cleanup();
  await sql.end();
  await privilegedSql.end();
});

// ---------------------------------------------------------------------------
// Helper: seed a single SUPPORTING evidence event for the test project.
// ---------------------------------------------------------------------------
async function seedEvent(args: { payloadText?: string; capturedAt?: Date } = {}): Promise<void> {
  const payload = args.payloadText !== undefined ? { _v: 1, text: args.payloadText } : { _v: 1 };
  await insertEventWithChain({
    tenant_id: TENANT,
    subject_tenant_id: SUBJECT,
    project_id: PROJECT,
    kind: 'SUPPORTING',
    payload,
    classification: null,
    captured_at: args.capturedAt ?? new Date(),
    captured_by_user_id: ADMIN_USER,
    override_of_event_id: null,
    override_new_kind: null,
    override_reason: null,
    idempotency_key: null,
  });
}

// ---------------------------------------------------------------------------
// Tests: feature flag / tenant gate (no DB needed).
// ---------------------------------------------------------------------------

test('feature flag disabled: returns skipped_disabled, no DB read', async () => {
  process.env.P6_AGENT_B_ENABLED = 'false';
  _reloadEnvForTests();
  const result = await runClaimActivityProposalJob({
    claim_id: CLAIM,
    tenant_id: TENANT,
  });
  assert.equal(result.status, 'skipped_disabled');
  assert.match(result.reason ?? '', /P6_AGENT_B_ENABLED/);
});

test('tenant not in allowlist: returns skipped_disabled', async () => {
  process.env.P6_AGENT_TENANT_ALLOWLIST = '00000000-0000-0000-0000-deadbeef0000';
  _reloadEnvForTests();
  const result = await runClaimActivityProposalJob({
    claim_id: CLAIM,
    tenant_id: TENANT,
  });
  assert.equal(result.status, 'skipped_disabled');
  assert.match(result.reason ?? '', /allowlist/i);
});

// ---------------------------------------------------------------------------
// Tests: input validation.
// ---------------------------------------------------------------------------

test('invalid input: missing claim_id returns failed', async () => {
  const result = await runClaimActivityProposalJob({ tenant_id: TENANT });
  assert.equal(result.status, 'failed');
  assert.match(result.reason ?? '', /invalid job input/i);
});

test('invalid input: non-UUID claim_id returns failed', async () => {
  const result = await runClaimActivityProposalJob({
    claim_id: 'not-a-uuid',
    tenant_id: TENANT,
  });
  assert.equal(result.status, 'failed');
  assert.match(result.reason ?? '', /invalid job input/i);
});

// ---------------------------------------------------------------------------
// Tests: claim lookup failures.
// ---------------------------------------------------------------------------

test('claim not found: returns failed with reason', async () => {
  const result = await runClaimActivityProposalJob({
    claim_id: '00000000-0000-4000-8000-00000000dead',
    tenant_id: TENANT,
  });
  assert.equal(result.status, 'failed');
  assert.match(result.reason ?? '', /claim not found/);
});

test('claim exists but has no workflow_state: returns failed', async () => {
  const result = await runClaimActivityProposalJob({
    claim_id: CLAIM_NO_WORKFLOW,
    tenant_id: TENANT,
  });
  assert.equal(result.status, 'failed');
  assert.match(result.reason ?? '', /claim not found or has no workflow_state/);
});

test('claim belongs to different tenant: returns failed', async () => {
  const result = await runClaimActivityProposalJob({
    claim_id: CLAIM,
    tenant_id: '00000000-0000-4000-8000-00000000dead',
  });
  assert.equal(result.status, 'failed');
  assert.match(result.reason ?? '', /claim not found/);
});

// ---------------------------------------------------------------------------
// Tests: happy path (stub synthesizer).
// ---------------------------------------------------------------------------

test('happy path with no events: synthesizes ACTIVITY_REGISTER_DRAFTED with 0 proposals', async () => {
  const result = await runClaimActivityProposalJob({
    claim_id: CLAIM,
    tenant_id: TENANT,
  });

  assert.equal(result.status, 'synthesized');
  assert.equal(result.proposed_activity_count, 0);
  assert.equal(result.unclustered_event_count, 0);
  assert.equal(result.events_truncated, false);

  // Verify the chain event was written.
  const rows = await privilegedSql<
    { kind: string; captured_by_user_id: string; payload: { proposed_activities: unknown[] } }[]
  >`
    SELECT kind, captured_by_user_id, payload
      FROM event
     WHERE tenant_id = ${TENANT} AND kind = 'ACTIVITY_REGISTER_DRAFTED'
  `;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.kind, 'ACTIVITY_REGISTER_DRAFTED');
  assert.equal(rows[0]?.captured_by_user_id, AGENT_B_SYSTEM_USER_ID);
  assert.deepEqual(rows[0]?.payload.proposed_activities, []);
});

test('happy path with one event: stub clusters into 1 proposed activity', async () => {
  await seedEvent({ payloadText: 'experimented with novel ML optimiser' });

  const result = await runClaimActivityProposalJob({
    claim_id: CLAIM,
    tenant_id: TENANT,
  });

  assert.equal(result.status, 'synthesized');
  assert.equal(result.proposed_activity_count, 1);
  assert.equal(result.unclustered_event_count, 0);
  assert.equal(result.events_truncated, false);
});

test('idempotency: second call with same events returns skipped_idempotent, no duplicate event', async () => {
  await seedEvent({ payloadText: 'design doc draft' });

  const r1 = await runClaimActivityProposalJob({
    claim_id: CLAIM,
    tenant_id: TENANT,
  });
  assert.equal(r1.status, 'synthesized');

  const r2 = await runClaimActivityProposalJob({
    claim_id: CLAIM,
    tenant_id: TENANT,
  });
  assert.equal(r2.status, 'skipped_idempotent');
  assert.match(r2.reason ?? '', /cache hit/);

  // Only one ACTIVITY_REGISTER_DRAFTED event should exist.
  const countRows = await privilegedSql<{ c: string }[]>`
    SELECT COUNT(*)::text AS c FROM event
     WHERE tenant_id = ${TENANT} AND kind = 'ACTIVITY_REGISTER_DRAFTED'
  `;
  assert.equal(countRows[0]?.c, '1');
});

test('payload carries correct metadata: project_id, model, prompt_version', async () => {
  await seedEvent({ payloadText: 'telemetry-trigger event' });

  await runClaimActivityProposalJob({
    claim_id: CLAIM,
    tenant_id: TENANT,
  });

  const rows = await privilegedSql<
    { payload: { project_id: string; model: string; prompt_version: string } }[]
  >`
    SELECT payload
      FROM event
     WHERE tenant_id = ${TENANT} AND kind = 'ACTIVITY_REGISTER_DRAFTED'
  `;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.payload.project_id, PROJECT);
  assert.equal(rows[0]?.payload.prompt_version, 'synthesize-register@1.0.0');
  // Stub always reports model 'stub-v1.0.0'.
  assert.equal(rows[0]?.payload.model, 'stub-v1.0.0');
});
