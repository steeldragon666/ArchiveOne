import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../app.js';

/**
 * Integration tests for GET /v1/claims/:id/summary.pdf (C7).
 *
 * Cross-firm isolation, role gating, and stream headers are the
 * load-bearing assertions; PDF correctness is exercised in
 * `packages/documents/src/claim-summary.test.ts`.
 *
 * Docker-only — uses the live test database via @cpa/db/client. CI runs
 * the postgres container; local runs without Docker will fail at the
 * sql.begin step. Tests are intentionally idempotent (cleanup-first
 * before-block + after-block) so they can re-run after partial failures.
 */

const SESSION_SECRET = process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';

// Pinned UUIDs — the c7d0 segment groups all C7-route fixtures so cleanup
// in other test files doesn't collide.
const TENANT_A = '00000000-0000-4000-8000-0000c7d00001';
const TENANT_B = '00000000-0000-4000-8000-0000c7d00002';
const ADMIN_A = '00000000-0000-4000-8000-0000c7d00010';
const ADMIN_B = '00000000-0000-4000-8000-0000c7d00011';
const VIEWER_A = '00000000-0000-4000-8000-0000c7d00012';
const SUBJECT_A = '00000000-0000-4000-8000-0000c7d00021';
const SUBJECT_B = '00000000-0000-4000-8000-0000c7d00022';
const PROJECT_A = '00000000-0000-4000-8000-0000c7d00031';
const CLAIM_A = '00000000-0000-4000-8000-0000c7d00041';
const CLAIM_B = '00000000-0000-4000-8000-0000c7d00042';
const ACTIVITY_A = '00000000-0000-4000-8000-0000c7d00051';

const cleanup = async (): Promise<void> => {
  await privilegedSql`DELETE FROM activity WHERE id = ${ACTIVITY_A}`;
  await privilegedSql`DELETE FROM claim WHERE id IN (${CLAIM_A}, ${CLAIM_B})`;
  await privilegedSql`DELETE FROM project WHERE id = ${PROJECT_A}`;
  await privilegedSql`DELETE FROM subject_tenant WHERE id IN (${SUBJECT_A}, ${SUBJECT_B})`;
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await sql`DELETE FROM "user" WHERE id IN (${ADMIN_A}, ${ADMIN_B}, ${VIEWER_A})`;
  await sql`DELETE FROM tenant WHERE id IN (${TENANT_A}, ${TENANT_B})`;
};

before(async () => {
  await cleanup();
  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT_A}, 'Firm A C7', 'firm-a-c7', 'mixed'),
                   (${TENANT_B}, 'Firm B C7', 'firm-b-c7', 'mixed')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${ADMIN_A}, 'c7-admin-a@example.com', 'microsoft', 'microsoft:c7-admin-a', 'C7 Admin A'),
                   (${ADMIN_B}, 'c7-admin-b@example.com', 'microsoft', 'microsoft:c7-admin-b', 'C7 Admin B'),
                   (${VIEWER_A}, 'c7-viewer-a@example.com', 'microsoft', 'microsoft:c7-viewer-a', 'C7 Viewer A')`;
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_A}, ${ADMIN_A}, 'admin', true),
                              (gen_random_uuid(), ${TENANT_B}, ${ADMIN_B}, 'admin', true),
                              (gen_random_uuid(), ${TENANT_A}, ${VIEWER_A}, 'viewer', true)`;
  await privilegedSql`INSERT INTO subject_tenant (id, tenant_id, name, kind)
                       VALUES (${SUBJECT_A}, ${TENANT_A}, 'Acme A', 'claimant'),
                              (${SUBJECT_B}, ${TENANT_B}, 'Acme B', 'claimant')`;
  await privilegedSql`INSERT INTO project (id, tenant_id, subject_tenant_id, name, description, started_at)
                       VALUES (${PROJECT_A}, ${TENANT_A}, ${SUBJECT_A}, 'C7 Project', 'C7 test project', '2026-07-01T00:00:00Z')`;
  await privilegedSql`INSERT INTO claim (id, tenant_id, subject_tenant_id, fiscal_year, stage)
                       VALUES (${CLAIM_A}, ${TENANT_A}, ${SUBJECT_A}, 2027, 'narrative_drafting'),
                              (${CLAIM_B}, ${TENANT_B}, ${SUBJECT_B}, 2027, 'narrative_drafting')`;
  await privilegedSql`INSERT INTO activity (id, tenant_id, project_id, claim_id, code, kind, title)
                       VALUES (${ACTIVITY_A}, ${TENANT_A}, ${PROJECT_A}, ${CLAIM_A}, 'CA-001', 'core', 'Adaptive scaffolding')`;
});

after(async () => {
  await cleanup();
  await sql.end();
  await privilegedSql.end();
});

const jwtFor = (
  userId: string,
  email: string,
  tenantId: string,
  role: 'admin' | 'consultant' | 'viewer' = 'admin',
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

test('GET /v1/claims/:id/summary.pdf: 401 without session', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM_A}/summary.pdf`,
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('GET /v1/claims/:id/summary.pdf: 200 happy path (admin)', async () => {
  const app = buildApp();
  const jwt = await jwtFor(ADMIN_A, 'c7-admin-a@example.com', TENANT_A, 'admin');
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM_A}/summary.pdf`,
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 200);
  // Magic bytes: %PDF
  const head = res.rawPayload.subarray(0, 4).toString('utf8');
  assert.equal(head, '%PDF', `expected %PDF magic, got "${head}"`);
  // Sanity bound: real PDF is several KB
  assert.ok(res.rawPayload.length > 1024, `PDF too small: ${res.rawPayload.length}b`);
  await app.close();
});

test('GET /v1/claims/:id/summary.pdf: 200 with viewer role', async () => {
  const app = buildApp();
  const jwt = await jwtFor(VIEWER_A, 'c7-viewer-a@example.com', TENANT_A, 'viewer');
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM_A}/summary.pdf`,
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test('GET /v1/claims/:id/summary.pdf: 404 cross-firm (TENANT_B caller)', async () => {
  // Positive control: ADMIN_B can fetch their own claim, but not CLAIM_A.
  const app = buildApp();
  const jwt = await jwtFor(ADMIN_B, 'c7-admin-b@example.com', TENANT_B, 'admin');
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM_A}/summary.pdf`,
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 404);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'claim_not_found');
  await app.close();
});

test('GET /v1/claims/:id/summary.pdf: 404 nonexistent claim', async () => {
  const app = buildApp();
  const jwt = await jwtFor(ADMIN_A, 'c7-admin-a@example.com', TENANT_A, 'admin');
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/00000000-0000-4000-8000-000000000000/summary.pdf`,
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('GET /v1/claims/:id/summary.pdf: 200 sets streaming headers', async () => {
  const app = buildApp();
  const jwt = await jwtFor(ADMIN_A, 'c7-admin-a@example.com', TENANT_A, 'admin');
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM_A}/summary.pdf`,
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  const disp = res.headers['content-disposition'];
  assert.ok(disp, 'Content-Disposition header missing');
  assert.match(String(disp), /^attachment; filename="claim-2027-firm-a-c7-summary\.pdf"$/);
  assert.equal(res.headers['cache-control'], 'private, no-store');
  await app.close();
});
