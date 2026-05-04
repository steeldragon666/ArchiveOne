/**
 * Tests for the P6 Task 5.7 stale-streaming-cleanup job.
 *
 * The job reaps `narrative_draft` rows that are stuck in
 * `status='streaming'` and haven't been touched in
 * `P6_NARRATIVE_STALE_THRESHOLD_MIN` minutes (default 10). These tests
 * cover:
 *   1. Empty table → 0 flipped
 *   2. Fresh streaming row not reaped
 *   3. Stale streaming row reaped (status flips, count = 1)
 *   4. Complete row not touched (cleanup only targets streaming)
 *   5. Multiple stale rows reaped in one pass
 *   6. P6_NARRATIVE_STALE_THRESHOLD_MIN env override
 *   7. Idempotency / re-run sweeps zero
 *
 * Fixtures pin tenant/user/project/claim/activity inside the
 * `c5701` UUID prefix so they don't collide with other narrative-route
 * fixtures (`c5500`, `c5501`).
 */

import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sql, privilegedSql } from '@cpa/db/client';
import { runNarrativeStaleCleanup } from './narrative-stale-cleanup.js';

// UUID prefix `c5701` keeps these fixtures disjoint from other tests.
const TENANT = '00000000-0000-4000-8000-0000000c5701';
const ADMIN_USER = '00000000-0000-4000-8000-0000000c5710';
const SUBJECT = '00000000-0000-4000-8000-0000000c5720';
const PROJECT = '00000000-0000-4000-8000-0000000c5730';
const CLAIM = '00000000-0000-4000-8000-0000000c5740';
const ACTIVITY = '00000000-0000-4000-8000-0000000c5750';

const SECTION_KINDS = [
  'new_knowledge',
  'hypothesis',
  'uncertainty',
  'experiments_and_results',
] as const;
type SectionKind = (typeof SECTION_KINDS)[number];

const cleanupRows = async (): Promise<void> => {
  await privilegedSql`DELETE FROM narrative_draft WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM activity WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM claim WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM project WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM subject_tenant WHERE tenant_id = ${TENANT}`;
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT}`;
  await sql`DELETE FROM "user" WHERE id = ${ADMIN_USER}`;
  await sql`DELETE FROM tenant WHERE id = ${TENANT}`;
};

before(async () => {
  await cleanupRows();
  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT}, 'Firm C5701', 'firm-c5701', 'mixed')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${ADMIN_USER}, 'c5701-admin@example.com', 'microsoft',
                    'microsoft:c5701-admin', 'C5701 Admin')`;
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT}, ${ADMIN_USER}, 'admin', true)`;
  await privilegedSql`INSERT INTO subject_tenant (id, tenant_id, name, kind)
                       VALUES (${SUBJECT}, ${TENANT}, 'Acme C5701', 'claimant')`;
  await privilegedSql`INSERT INTO project (id, tenant_id, subject_tenant_id, name, started_at)
                       VALUES (${PROJECT}, ${TENANT}, ${SUBJECT}, 'C5701 Project',
                               '2024-07-01T00:00:00Z'::timestamptz)`;
  await privilegedSql`INSERT INTO claim (id, tenant_id, subject_tenant_id, project_id, fiscal_year, stage)
                       VALUES (${CLAIM}, ${TENANT}, ${SUBJECT}, ${PROJECT}, 2025, 'engagement')`;
  await privilegedSql`INSERT INTO activity (id, tenant_id, project_id, claim_id, code, kind, title,
                                            fy_label, hypothesis_formed_at)
                       VALUES (${ACTIVITY}, ${TENANT}, ${PROJECT}, ${CLAIM},
                               'CA-01', 'core', 'C5701 Activity',
                               'FY25', '2025-01-01T00:00:00Z')`;
});

beforeEach(async () => {
  // Per-test isolation: drop draft rows; preserve env var unless a
  // specific test sets it (each test that overrides restores in finally).
  await privilegedSql`DELETE FROM narrative_draft WHERE tenant_id = ${TENANT}`;
  delete process.env.P6_NARRATIVE_STALE_THRESHOLD_MIN;
});

after(async () => {
  await cleanupRows();
  await sql.end();
  await privilegedSql.end();
});

/**
 * Insert a single narrative_draft row with full control over `status`
 * and `updated_at`. Each draft maps to a distinct section_kind so the
 * `(tenant_id, activity_id, section_kind)` uniqueness constraint
 * doesn't fire across multiple rows in the same activity.
 *
 * Note: drizzle's `$onUpdate` only fires for ORM-mediated writes; we
 * pin `updated_at` directly via the raw INSERT so the row materialises
 * at the timestamp the test wants.
 */
async function seedDraft(args: {
  status: 'streaming' | 'complete' | 'accepted' | 'archived';
  updatedAt: Date;
  sectionKind?: SectionKind;
}): Promise<{ id: string; sectionKind: SectionKind }> {
  const id = crypto.randomUUID();
  const sectionKind = args.sectionKind ?? SECTION_KINDS[0];
  const segments = JSON.stringify([{ kind: 'prose', text: 'placeholder' }]);
  const contentHash = '0'.repeat(64);
  await privilegedSql`
    INSERT INTO narrative_draft (
      tenant_id, id, activity_id, section_kind, current_version, status,
      segments, content_hash, model, prompt_version, idempotency_key,
      created_at, updated_at, created_by_user_id
    ) VALUES (
      ${TENANT}, ${id}, ${ACTIVITY}, ${sectionKind}, 1, ${args.status},
      ${segments}::text::jsonb,
      ${contentHash}, 'claude-test', 'v1.0.0', NULL,
      ${args.updatedAt.toISOString()}::timestamptz,
      ${args.updatedAt.toISOString()}::timestamptz,
      ${ADMIN_USER}
    )
  `;
  return { id, sectionKind };
}

async function fetchStatus(id: string): Promise<string | null> {
  const rows = await privilegedSql<{ status: string }[]>`
    SELECT status FROM narrative_draft WHERE tenant_id = ${TENANT} AND id = ${id}
  `;
  return rows[0]?.status ?? null;
}

// ---------------------------------------------------------------------------

test('runNarrativeStaleCleanup: empty narrative_draft table → returns 0', async () => {
  const result = await runNarrativeStaleCleanup();
  assert.equal(result.rows_flipped, 0);
});

test('runNarrativeStaleCleanup: fresh streaming row is not reaped', async () => {
  const { id } = await seedDraft({
    status: 'streaming',
    updatedAt: new Date(),
    sectionKind: 'new_knowledge',
  });

  const result = await runNarrativeStaleCleanup();
  assert.equal(result.rows_flipped, 0);
  assert.equal(await fetchStatus(id), 'streaming');
});

test('runNarrativeStaleCleanup: stale streaming row is flipped to complete', async () => {
  const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000);
  const { id } = await seedDraft({
    status: 'streaming',
    updatedAt: elevenMinAgo,
    sectionKind: 'hypothesis',
  });

  const result = await runNarrativeStaleCleanup();
  assert.equal(result.rows_flipped, 1);
  assert.equal(await fetchStatus(id), 'complete');
});

test('runNarrativeStaleCleanup: complete row with old updated_at is not touched', async () => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const { id } = await seedDraft({
    status: 'complete',
    updatedAt: oneHourAgo,
    sectionKind: 'uncertainty',
  });

  const result = await runNarrativeStaleCleanup();
  assert.equal(result.rows_flipped, 0);
  assert.equal(await fetchStatus(id), 'complete');
});

test('runNarrativeStaleCleanup: multiple stale streaming rows reaped in one pass', async () => {
  const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000);
  // Three distinct section_kinds satisfy the
  // (tenant_id, activity_id, section_kind) unique constraint.
  const drafts = await Promise.all([
    seedDraft({ status: 'streaming', updatedAt: elevenMinAgo, sectionKind: 'new_knowledge' }),
    seedDraft({ status: 'streaming', updatedAt: elevenMinAgo, sectionKind: 'hypothesis' }),
    seedDraft({
      status: 'streaming',
      updatedAt: elevenMinAgo,
      sectionKind: 'experiments_and_results',
    }),
  ]);

  const result = await runNarrativeStaleCleanup();
  assert.equal(result.rows_flipped, 3);
  for (const d of drafts) {
    assert.equal(await fetchStatus(d.id), 'complete');
  }
});

test('runNarrativeStaleCleanup: P6_NARRATIVE_STALE_THRESHOLD_MIN env overrides the default', async () => {
  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
  const { id } = await seedDraft({
    status: 'streaming',
    updatedAt: twoMinAgo,
    sectionKind: 'new_knowledge',
  });

  const prev = process.env.P6_NARRATIVE_STALE_THRESHOLD_MIN;
  process.env.P6_NARRATIVE_STALE_THRESHOLD_MIN = '1';
  try {
    const result = await runNarrativeStaleCleanup();
    assert.equal(result.rows_flipped, 1);
    assert.equal(await fetchStatus(id), 'complete');
  } finally {
    if (prev === undefined) delete process.env.P6_NARRATIVE_STALE_THRESHOLD_MIN;
    else process.env.P6_NARRATIVE_STALE_THRESHOLD_MIN = prev;
  }
});

test('runNarrativeStaleCleanup: re-run after a sweep reaps zero (idempotent)', async () => {
  const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000);
  await seedDraft({
    status: 'streaming',
    updatedAt: elevenMinAgo,
    sectionKind: 'new_knowledge',
  });
  await seedDraft({
    status: 'streaming',
    updatedAt: elevenMinAgo,
    sectionKind: 'hypothesis',
  });

  const first = await runNarrativeStaleCleanup();
  assert.equal(first.rows_flipped, 2);

  const second = await runNarrativeStaleCleanup();
  assert.equal(second.rows_flipped, 0);
});
