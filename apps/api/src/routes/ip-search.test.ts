import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { sql, privilegedSql } from '@cpa/db/client';

/**
 * Positive-control RLS tests for the three Wizard Step 2 / IP-search
 * tables (`ip_search_run`, `ip_search_hit`, `ip_search_verdict`).
 *
 * Mirrors the canonical pattern from `audit-log.test.ts`, but against
 * the standard `app.current_tenant_id` GUC (these tables don't use
 * the parallel firm GUC — they are subject-tenant-claim-scoped, so the
 * tenant GUC is the right gate).
 *
 * The three assertions per table (visibility filter, GUC-unset fail-safe,
 * privileged-bypass sanity) are MANDATORY before any wizard-step-2
 * follow-up tasks (02–07) wire write paths — RLS leakage would silently
 * expose one firm's IP-search history (including external API responses)
 * to another firm.
 *
 * The `ip_search_hit` policy is an EXISTS subquery against
 * `ip_search_run`, not a direct `tenant_id` filter. The visibility test
 * still verifies the same property: a TENANT_A session sees only hits
 * whose parent run belongs to TENANT_A.
 *
 * Seeded fixtures live under their own UUID block (suffix `f1d*`) so
 * they don't collide with any other test suite's seed range.
 */

const TENANT_A = '00000000-0000-4000-8000-0000000f1d01';
const TENANT_B = '00000000-0000-4000-8000-0000000f1d02';
const USER_A = '00000000-0000-4000-8000-0000000f1da1';
const USER_B = '00000000-0000-4000-8000-0000000f1da2';
const SUBJECT_A = '00000000-0000-4000-8000-0000000f1d51';
const SUBJECT_B = '00000000-0000-4000-8000-0000000f1d52';
const PROJECT_A = '00000000-0000-4000-8000-0000000f1d61';
const PROJECT_B = '00000000-0000-4000-8000-0000000f1d62';
const CLAIM_A = '00000000-0000-4000-8000-0000000f1d71';
const CLAIM_B = '00000000-0000-4000-8000-0000000f1d72';
const ACTIVITY_A = '00000000-0000-4000-8000-0000000f1d81';
const ACTIVITY_B = '00000000-0000-4000-8000-0000000f1d82';
const RUN_A = '00000000-0000-4000-8000-0000000f1d91';
const RUN_B = '00000000-0000-4000-8000-0000000f1d92';
const HIT_A = '00000000-0000-4000-8000-0000000f1da3';
const HIT_B = '00000000-0000-4000-8000-0000000f1da4';
const VERDICT_A = '00000000-0000-4000-8000-0000000f1db1';
const VERDICT_B = '00000000-0000-4000-8000-0000000f1db2';

// Stable hypothesis_text values so the (activity_id, hypothesis_text)
// UNIQUE constraint isolates this suite from any future producer.
const HYPOTHESIS_A = 'IP-search RLS test hypothesis A';
const HYPOTHESIS_B = 'IP-search RLS test hypothesis B';

const cleanup = async (): Promise<void> => {
  // Reverse-FK delete order via privileged role (RLS-bypass) — child rows
  // first so cascade doesn't fight the explicit deletes, and so the
  // tenant DELETE at the bottom finds no surviving children. The
  // privileged path makes this independent of GUC state.
  await privilegedSql`DELETE FROM ip_search_verdict WHERE id IN (${VERDICT_A}, ${VERDICT_B})`;
  await privilegedSql`DELETE FROM ip_search_hit     WHERE id IN (${HIT_A}, ${HIT_B})`;
  await privilegedSql`DELETE FROM ip_search_run     WHERE id IN (${RUN_A}, ${RUN_B})`;
  await privilegedSql`DELETE FROM activity          WHERE id IN (${ACTIVITY_A}, ${ACTIVITY_B})`;
  await privilegedSql`DELETE FROM claim             WHERE id IN (${CLAIM_A}, ${CLAIM_B})`;
  await privilegedSql`DELETE FROM project           WHERE id IN (${PROJECT_A}, ${PROJECT_B})`;
  await privilegedSql`DELETE FROM subject_tenant    WHERE id IN (${SUBJECT_A}, ${SUBJECT_B})`;
  await privilegedSql`DELETE FROM "user"            WHERE id IN (${USER_A}, ${USER_B})`;
  await privilegedSql`DELETE FROM tenant            WHERE id IN (${TENANT_A}, ${TENANT_B})`;
};

before(async () => {
  await cleanup();

  // Seed parents via privileged role — RLS-bypass for ergonomic cross-
  // tenant fixture creation. Mirrors audit-log.test.ts pattern.
  await privilegedSql`
    INSERT INTO tenant (id, name, slug, primary_idp)
    VALUES (${TENANT_A}, 'IP-search Firm A', 'ip-search-firm-a', 'mixed'),
           (${TENANT_B}, 'IP-search Firm B', 'ip-search-firm-b', 'mixed')
  `;
  await privilegedSql`
    INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
    VALUES (${USER_A}, 'ip-search-rls-a@example.com', 'microsoft', 'microsoft:ip-search-rls-a', 'IP-search A'),
           (${USER_B}, 'ip-search-rls-b@example.com', 'microsoft', 'microsoft:ip-search-rls-b', 'IP-search B')
  `;
  await privilegedSql`
    INSERT INTO subject_tenant (id, tenant_id, name, kind)
    VALUES (${SUBJECT_A}, ${TENANT_A}, 'IP-search Claimant A', 'claimant'),
           (${SUBJECT_B}, ${TENANT_B}, 'IP-search Claimant B', 'claimant')
  `;
  await privilegedSql`
    INSERT INTO project (id, tenant_id, subject_tenant_id, name, started_at)
    VALUES (${PROJECT_A}, ${TENANT_A}, ${SUBJECT_A}, 'IP-search Project A', '2024-07-01T00:00:00Z'),
           (${PROJECT_B}, ${TENANT_B}, ${SUBJECT_B}, 'IP-search Project B', '2024-07-01T00:00:00Z')
  `;
  await privilegedSql`
    INSERT INTO claim (id, tenant_id, subject_tenant_id, fiscal_year, stage)
    VALUES (${CLAIM_A}, ${TENANT_A}, ${SUBJECT_A}, 2025, 'engagement'),
           (${CLAIM_B}, ${TENANT_B}, ${SUBJECT_B}, 2025, 'engagement')
  `;
  await privilegedSql`
    INSERT INTO activity (id, tenant_id, project_id, claim_id, code, kind, title, fy_label, hypothesis_formed_at)
    VALUES (${ACTIVITY_A}, ${TENANT_A}, ${PROJECT_A}, ${CLAIM_A}, 'CA-01', 'core', 'IP-search Activity A',
            'FY25', '2025-01-01T00:00:00Z'),
           (${ACTIVITY_B}, ${TENANT_B}, ${PROJECT_B}, ${CLAIM_B}, 'CA-01', 'core', 'IP-search Activity B',
            'FY25', '2025-01-01T00:00:00Z')
  `;

  // ip_search_run — one row per tenant.
  await privilegedSql`
    INSERT INTO ip_search_run (
      id, tenant_id, claim_id, activity_id,
      hypothesis_text, hypothesis_hash, database_name, query, query_source,
      raw_response, result_count, ran_by_user_id
    ) VALUES
      (${RUN_A}, ${TENANT_A}, ${CLAIM_A}, ${ACTIVITY_A},
       ${HYPOTHESIS_A},
       'deadbeefa', 'ip_australia', 'novel solar panel coating', 'llm',
       ${{}}, 0, ${USER_A}),
      (${RUN_B}, ${TENANT_B}, ${CLAIM_B}, ${ACTIVITY_B},
       ${HYPOTHESIS_B},
       'deadbeefb', 'pubmed', 'graphene battery thermal stability', 'llm',
       ${{}}, 0, ${USER_B})
  `;

  // ip_search_hit — one row per tenant, attached to that tenant's run.
  // Tenant scope is inherited via the ip_search_hit RLS policy
  // (EXISTS over ip_search_run.tenant_id).
  await privilegedSql`
    INSERT INTO ip_search_hit (id, search_run_id, external_id, title, url)
    VALUES (${HIT_A}, ${RUN_A}, 'AU2023-12345', 'IP-search RLS test hit A', 'https://example.invalid/a'),
           (${HIT_B}, ${RUN_B}, 'pubmed:99999',   'IP-search RLS test hit B', 'https://example.invalid/b')
  `;

  // ip_search_verdict — one row per tenant.
  await privilegedSql`
    INSERT INTO ip_search_verdict (
      id, tenant_id, claim_id, activity_id,
      hypothesis_text, verdict, draft_verdict, analysis_markdown, approved_by_user_id, approved_at
    ) VALUES
      (${VERDICT_A}, ${TENANT_A}, ${CLAIM_A}, ${ACTIVITY_A},
       ${HYPOTHESIS_A}, 'pass', 'pass', 'IP-search RLS test analysis A', ${USER_A}, now()),
      (${VERDICT_B}, ${TENANT_B}, ${CLAIM_B}, ${ACTIVITY_B},
       ${HYPOTHESIS_B}, 'inconclusive', 'inconclusive', 'IP-search RLS test analysis B', ${USER_B}, now())
  `;
});

after(async () => {
  await cleanup();
  await sql.end();
  await privilegedSql.end();
});

// ---------------------------------------------------------------------------
// ip_search_run — direct tenant_id policy
// ---------------------------------------------------------------------------

test('ip_search_run RLS: TENANT_A session cannot read TENANT_B rows', async () => {
  const rows = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`;
    return tx<{ id: string; tenant_id: string }[]>`
      SELECT id, tenant_id FROM ip_search_run
       WHERE id IN (${RUN_A}, ${RUN_B})
    `;
  });

  assert.equal(rows.length, 1, 'should see exactly 1 row (TENANT_A only)');
  assert.equal(rows[0]?.id, RUN_A);
  assert.equal(rows[0]?.tenant_id, TENANT_A);
});

test('ip_search_run RLS: GUC unset → query returns no rows (fail-safe)', async () => {
  const rows = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', '', true)`;
    return tx<{ id: string }[]>`
      SELECT id FROM ip_search_run
       WHERE id IN (${RUN_A}, ${RUN_B})
    `;
  });

  assert.equal(rows.length, 0, 'GUC unset must return zero rows (fail-safe)');
});

test('ip_search_run RLS: privilegedSql bypasses RLS — sanity check', async () => {
  const rows = await privilegedSql<{ id: string; tenant_id: string }[]>`
    SELECT id, tenant_id FROM ip_search_run
     WHERE id IN (${RUN_A}, ${RUN_B})
     ORDER BY tenant_id
  `;
  assert.equal(rows.length, 2, 'privilegedSql must see both tenant rows');
});

// ---------------------------------------------------------------------------
// ip_search_hit — EXISTS-against-parent policy
// ---------------------------------------------------------------------------

test('ip_search_hit RLS: TENANT_A session sees only hits under TENANT_A runs', async () => {
  const rows = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`;
    return tx<{ id: string; search_run_id: string }[]>`
      SELECT id, search_run_id FROM ip_search_hit
       WHERE id IN (${HIT_A}, ${HIT_B})
    `;
  });

  assert.equal(rows.length, 1, 'should see exactly 1 hit (TENANT_A only)');
  assert.equal(rows[0]?.id, HIT_A);
  assert.equal(rows[0]?.search_run_id, RUN_A);
});

test('ip_search_hit RLS: GUC unset → query returns no rows (fail-safe)', async () => {
  const rows = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', '', true)`;
    return tx<{ id: string }[]>`
      SELECT id FROM ip_search_hit
       WHERE id IN (${HIT_A}, ${HIT_B})
    `;
  });

  assert.equal(rows.length, 0, 'GUC unset must return zero rows (fail-safe)');
});

test('ip_search_hit RLS: privilegedSql bypasses RLS — sanity check', async () => {
  const rows = await privilegedSql<{ id: string }[]>`
    SELECT id FROM ip_search_hit
     WHERE id IN (${HIT_A}, ${HIT_B})
     ORDER BY id
  `;
  assert.equal(rows.length, 2, 'privilegedSql must see both hits');
});

// ---------------------------------------------------------------------------
// ip_search_verdict — direct tenant_id policy
// ---------------------------------------------------------------------------

test('ip_search_verdict RLS: TENANT_A session cannot read TENANT_B rows', async () => {
  const rows = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`;
    return tx<{ id: string; tenant_id: string }[]>`
      SELECT id, tenant_id FROM ip_search_verdict
       WHERE id IN (${VERDICT_A}, ${VERDICT_B})
    `;
  });

  assert.equal(rows.length, 1, 'should see exactly 1 verdict (TENANT_A only)');
  assert.equal(rows[0]?.id, VERDICT_A);
  assert.equal(rows[0]?.tenant_id, TENANT_A);
});

test('ip_search_verdict RLS: GUC unset → query returns no rows (fail-safe)', async () => {
  const rows = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', '', true)`;
    return tx<{ id: string }[]>`
      SELECT id FROM ip_search_verdict
       WHERE id IN (${VERDICT_A}, ${VERDICT_B})
    `;
  });

  assert.equal(rows.length, 0, 'GUC unset must return zero rows (fail-safe)');
});

test('ip_search_verdict RLS: privilegedSql bypasses RLS — sanity check', async () => {
  const rows = await privilegedSql<{ id: string; tenant_id: string }[]>`
    SELECT id, tenant_id FROM ip_search_verdict
     WHERE id IN (${VERDICT_A}, ${VERDICT_B})
     ORDER BY tenant_id
  `;
  assert.equal(rows.length, 2, 'privilegedSql must see both verdicts');
});

// ---------------------------------------------------------------------------
// Cache index existence — verifies migration acceptance criterion that
// `ip_search_run_cache_idx` was created. Cheap pg_class lookup.
// ---------------------------------------------------------------------------

test('ip_search_run_cache_idx exists (migration acceptance check)', async () => {
  const rows = await privilegedSql<{ relname: string }[]>`
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'i'
       AND c.relname = 'ip_search_run_cache_idx'
  `;
  assert.equal(rows.length, 1, 'ip_search_run_cache_idx must exist');
});
