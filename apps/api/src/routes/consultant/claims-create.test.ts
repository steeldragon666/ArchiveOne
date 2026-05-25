/**
 * Tests for POST /v1/consultant/claims (D5 — wire header "+ New claim" button).
 *
 * Covers:
 *   - Happy path: creates a claim row visible under the caller's tenant.
 *   - Cross-tenant isolation: a caller from firm A cannot see / cannot
 *     accidentally pollute firm B's claim list when both POST.
 *   - Auth: 401 without session, 403 for viewer role.
 *   - Empty state: 422 'no_clients' when the tenant has no subject_tenant
 *     rows yet.
 *
 * UUID-prefix namespace `0000d5XXXX` — disjoint from T-A2 (`0000a2XXXX`)
 * and D1 so parallel test runs don't collide on shared cleanup paths.
 */
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../../app.js';

const SESSION_SECRET = process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';

const TENANT_A = '00000000-0000-4000-8000-0000000d5001';
const TENANT_B = '00000000-0000-4000-8000-0000000d5002';
const TENANT_EMPTY = '00000000-0000-4000-8000-0000000d5003'; // no subject_tenant rows

const ADMIN_A = '00000000-0000-4000-8000-0000000d5010';
const CONSULTANT_A = '00000000-0000-4000-8000-0000000d5011';
const VIEWER_A = '00000000-0000-4000-8000-0000000d5012';
const ADMIN_B = '00000000-0000-4000-8000-0000000d5013';
const ADMIN_EMPTY = '00000000-0000-4000-8000-0000000d5014';

const SUBJECT_A1 = '00000000-0000-4000-8000-0000000d5021';
const SUBJECT_A2 = '00000000-0000-4000-8000-0000000d5022';
const SUBJECT_B1 = '00000000-0000-4000-8000-0000000d5023';

const cleanup = async (): Promise<void> => {
  await privilegedSql`
    DELETE FROM claim
     WHERE tenant_id IN (${TENANT_A}, ${TENANT_B}, ${TENANT_EMPTY})
  `;
  await privilegedSql`
    DELETE FROM subject_tenant
     WHERE tenant_id IN (${TENANT_A}, ${TENANT_B}, ${TENANT_EMPTY})
  `;
  await privilegedSql`
    DELETE FROM tenant_user
     WHERE tenant_id IN (${TENANT_A}, ${TENANT_B}, ${TENANT_EMPTY})
  `;
  await sql`
    DELETE FROM "user"
     WHERE id IN (${ADMIN_A}, ${CONSULTANT_A}, ${VIEWER_A}, ${ADMIN_B}, ${ADMIN_EMPTY})
  `;
  await sql`
    DELETE FROM tenant
     WHERE id IN (${TENANT_A}, ${TENANT_B}, ${TENANT_EMPTY})
  `;
};

before(async () => {
  await cleanup();

  await sql`
    INSERT INTO tenant (id, name, slug, primary_idp) VALUES
      (${TENANT_A}, 'D5 Firm A', 'd5-firm-a', 'mixed'),
      (${TENANT_B}, 'D5 Firm B', 'd5-firm-b', 'mixed'),
      (${TENANT_EMPTY}, 'D5 Firm Empty', 'd5-firm-empty', 'mixed')
  `;
  await sql`
    INSERT INTO "user" (id, email, primary_idp, external_id, display_name) VALUES
      (${ADMIN_A}, 'd5-admin-a@example.com', 'microsoft', 'microsoft:d5-admin-a', 'D5 Admin A'),
      (${CONSULTANT_A}, 'd5-cons-a@example.com', 'microsoft', 'microsoft:d5-cons-a', 'D5 Cons A'),
      (${VIEWER_A}, 'd5-viewer-a@example.com', 'microsoft', 'microsoft:d5-viewer-a', 'D5 Viewer A'),
      (${ADMIN_B}, 'd5-admin-b@example.com', 'microsoft', 'microsoft:d5-admin-b', 'D5 Admin B'),
      (${ADMIN_EMPTY}, 'd5-admin-empty@example.com', 'microsoft', 'microsoft:d5-admin-empty', 'D5 Admin Empty')
  `;
  await privilegedSql`
    INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default) VALUES
      (gen_random_uuid(), ${TENANT_A}, ${ADMIN_A}, 'admin', true),
      (gen_random_uuid(), ${TENANT_A}, ${CONSULTANT_A}, 'consultant', true),
      (gen_random_uuid(), ${TENANT_A}, ${VIEWER_A}, 'viewer', true),
      (gen_random_uuid(), ${TENANT_B}, ${ADMIN_B}, 'admin', true),
      (gen_random_uuid(), ${TENANT_EMPTY}, ${ADMIN_EMPTY}, 'admin', true)
  `;
  await privilegedSql`
    INSERT INTO subject_tenant (id, tenant_id, name, kind) VALUES
      (${SUBJECT_A1}, ${TENANT_A}, 'D5 Acme', 'claimant'),
      (${SUBJECT_A2}, ${TENANT_A}, 'D5 Beta', 'claimant'),
      (${SUBJECT_B1}, ${TENANT_B}, 'D5 Other', 'claimant')
  `;
});

after(async () => {
  await cleanup();
  await sql.end();
  await privilegedSql.end();
});

const jwtFor = (
  userId: string,
  email: string,
  role: 'admin' | 'consultant' | 'viewer',
  tenantId: string,
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

const consultantAJwt = (): Promise<string> =>
  jwtFor(CONSULTANT_A, 'd5-cons-a@example.com', 'consultant', TENANT_A);
const adminAJwt = (): Promise<string> =>
  jwtFor(ADMIN_A, 'd5-admin-a@example.com', 'admin', TENANT_A);
const viewerAJwt = (): Promise<string> =>
  jwtFor(VIEWER_A, 'd5-viewer-a@example.com', 'viewer', TENANT_A);
const adminBJwt = (): Promise<string> =>
  jwtFor(ADMIN_B, 'd5-admin-b@example.com', 'admin', TENANT_B);
const adminEmptyJwt = (): Promise<string> =>
  jwtFor(ADMIN_EMPTY, 'd5-admin-empty@example.com', 'admin', TENANT_EMPTY);

// =============================================================================
// POST /v1/consultant/claims
// =============================================================================

test('POST /v1/consultant/claims: 401 without session', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/consultant/claims',
    payload: { client_id: null },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('POST /v1/consultant/claims: 403 for viewer role', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/consultant/claims',
    cookies: { cpa_session: await viewerAJwt() },
    payload: { client_id: null },
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test('POST /v1/consultant/claims: 201 + DB row scoped to caller tenant (client_id null → placeholder)', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/consultant/claims',
    cookies: { cpa_session: await consultantAJwt() },
    payload: { client_id: null },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json<{ id: string }>();
  assert.ok(typeof body.id === 'string' && body.id.length > 0);

  const rows = await privilegedSql<
    { tenant_id: string; stage: string; subject_tenant_id: string }[]
  >`
    SELECT tenant_id, stage, subject_tenant_id
      FROM claim
     WHERE id = ${body.id}
  `;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.tenant_id, TENANT_A);
  assert.equal(rows[0]!.stage, 'engagement');
  assert.ok([SUBJECT_A1, SUBJECT_A2].includes(rows[0]!.subject_tenant_id));

  await privilegedSql`DELETE FROM claim WHERE id = ${body.id}`;
  await app.close();
});

test('POST /v1/consultant/claims: 201 + explicit client_id honoured', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/consultant/claims',
    cookies: { cpa_session: await consultantAJwt() },
    payload: { client_id: SUBJECT_A2 },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json<{ id: string }>();

  const rows = await privilegedSql<{ subject_tenant_id: string }[]>`
    SELECT subject_tenant_id FROM claim WHERE id = ${body.id}
  `;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.subject_tenant_id, SUBJECT_A2);

  await privilegedSql`DELETE FROM claim WHERE id = ${body.id}`;
  await app.close();
});

test('POST /v1/consultant/claims: 404 when client_id belongs to another firm (RLS isolation)', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/consultant/claims',
    cookies: { cpa_session: await adminAJwt() },
    payload: { client_id: SUBJECT_B1 },
  });
  assert.equal(res.statusCode, 404);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'client_not_found');
  await app.close();
});

test('POST /v1/consultant/claims: cross-tenant isolation — A cannot see Bs new claim', async () => {
  const app = buildApp();
  const aRes = await app.inject({
    method: 'POST',
    url: '/v1/consultant/claims',
    cookies: { cpa_session: await consultantAJwt() },
    payload: {},
  });
  const bRes = await app.inject({
    method: 'POST',
    url: '/v1/consultant/claims',
    cookies: { cpa_session: await adminBJwt() },
    payload: {},
  });
  assert.equal(aRes.statusCode, 201);
  assert.equal(bRes.statusCode, 201);
  const aId = aRes.json<{ id: string }>().id;
  const bId = bRes.json<{ id: string }>().id;
  assert.notEqual(aId, bId);

  const visibleToA = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`;
    return tx<{ id: string }[]>`SELECT id FROM claim WHERE id IN (${aId}, ${bId})`;
  });
  assert.equal(visibleToA.length, 1);
  assert.equal(visibleToA[0]!.id, aId);

  const visibleToB = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${TENANT_B}, true)`;
    return tx<{ id: string }[]>`SELECT id FROM claim WHERE id IN (${aId}, ${bId})`;
  });
  assert.equal(visibleToB.length, 1);
  assert.equal(visibleToB[0]!.id, bId);

  await privilegedSql`DELETE FROM claim WHERE id IN (${aId}, ${bId})`;
  await app.close();
});

test('POST /v1/consultant/claims: 422 no_clients when tenant has no subject_tenant rows', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/consultant/claims',
    cookies: { cpa_session: await adminEmptyJwt() },
    payload: { client_id: null },
  });
  assert.equal(res.statusCode, 422);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'no_clients');
  await app.close();
});

test('POST /v1/consultant/claims: 400 on invalid client_id (not a uuid)', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/consultant/claims',
    cookies: { cpa_session: await consultantAJwt() },
    payload: { client_id: 'not-a-uuid' },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});
