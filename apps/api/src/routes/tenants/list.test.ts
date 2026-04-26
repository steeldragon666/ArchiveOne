import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../../app.js';

const SESSION_SECRET = process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';
const TENANT_A = '00000000-0000-4000-8000-0000000a4001';
const TENANT_B = '00000000-0000-4000-8000-0000000a4002';
const TEST_USER = '00000000-0000-4000-8000-0000000a4003';

before(async () => {
  // Idempotent — survive prior-run leftovers
  await privilegedSql`DELETE FROM tenant_user WHERE user_id = ${TEST_USER}`;
  await sql`DELETE FROM "user" WHERE id = ${TEST_USER}`;
  await sql`DELETE FROM tenant WHERE id IN (${TENANT_A}, ${TENANT_B})`;

  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT_A}, 'GET-Tenants A', 'get-tenants-a', 'mixed'),
                   (${TENANT_B}, 'GET-Tenants B', 'get-tenants-b', 'mixed')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id)
            VALUES (${TEST_USER}, 'gettest@example.com', 'microsoft', 'microsoft:get-tenants-test')`;
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_A}, ${TEST_USER}, 'consultant', false),
                              (gen_random_uuid(), ${TENANT_B}, ${TEST_USER}, 'admin', true)`;
});

after(async () => {
  await privilegedSql`DELETE FROM tenant_user WHERE user_id = ${TEST_USER}`;
  await sql`DELETE FROM "user" WHERE id = ${TEST_USER}`;
  await sql`DELETE FROM tenant WHERE id IN (${TENANT_A}, ${TENANT_B})`;
  await sql.end();
  await privilegedSql.end();
});

test('GET /v1/tenants: 401 without session cookie', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/v1/tenants' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('GET /v1/tenants: returns activeTenantId + availableTenants for authenticated user', async () => {
  const jwt = await signSession(
    {
      sub: TEST_USER,
      email: 'gettest@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: TENANT_B,
      activeRole: 'admin',
      availableTenants: [],
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/tenants',
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json<{
    activeTenantId: string | null;
    availableTenants: Array<{ tenantId: string; name: string; role: string; isDefault: boolean }>;
  }>();
  assert.equal(body.activeTenantId, TENANT_B, 'is_default tenant wins as active');
  assert.equal(body.availableTenants.length, 2);
  const a = body.availableTenants.find((t) => t.tenantId === TENANT_A);
  const b = body.availableTenants.find((t) => t.tenantId === TENANT_B);
  assert.equal(b?.role, 'admin');
  assert.equal(b?.isDefault, true);
  assert.equal(a?.role, 'consultant');
  assert.equal(a?.isDefault, false);
  await app.close();
});

test('GET /v1/tenants: 403 when user has no active tenant (sessionless)', async () => {
  const jwt = await signSession(
    {
      sub: TEST_USER,
      email: 'gettest@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: null,
      activeRole: null,
      availableTenants: [],
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/tenants',
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 403);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'no_active_tenant');
  await app.close();
});
