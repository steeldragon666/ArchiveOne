import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../../app.js';

const SESSION_SECRET = process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';
const TENANT_X = '00000000-0000-4000-8000-0000000a6001';
const TENANT_Y = '00000000-0000-4000-8000-0000000a6002';
const SWITCH_USER = '00000000-0000-4000-8000-0000000a6003';

before(async () => {
  await privilegedSql`DELETE FROM tenant_user WHERE user_id = ${SWITCH_USER}`;
  await sql`DELETE FROM "user" WHERE id = ${SWITCH_USER}`;
  await sql`DELETE FROM tenant WHERE id IN (${TENANT_X}, ${TENANT_Y})`;
  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT_X}, 'Switch X', 'switch-x', 'mixed'),
                   (${TENANT_Y}, 'Switch Y', 'switch-y', 'mixed')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${SWITCH_USER}, 'switch@example.com', 'microsoft', 'microsoft:switch-test', 'Switch User')`;
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_X}, ${SWITCH_USER}, 'consultant', true),
                              (gen_random_uuid(), ${TENANT_Y}, ${SWITCH_USER}, 'admin', false)`;
});

after(async () => {
  await privilegedSql`DELETE FROM tenant_user WHERE user_id = ${SWITCH_USER}`;
  await sql`DELETE FROM "user" WHERE id = ${SWITCH_USER}`;
  await sql`DELETE FROM tenant WHERE id IN (${TENANT_X}, ${TENANT_Y})`;
  await sql.end();
  await privilegedSql.end();
});

const buildJwt = async (activeTenantId: string, activeRole: 'admin' | 'consultant' | 'viewer') =>
  signSession(
    {
      sub: SWITCH_USER,
      email: 'switch@example.com',
      primaryIdp: 'microsoft',
      activeTenantId,
      activeRole,
      availableTenants: [],
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );

test('POST /v1/tenants/switch: 401 without session', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/tenants/switch',
    payload: { tenantId: TENANT_Y },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('POST /v1/tenants/switch: happy path — switches tenant, re-signs JWT, sets cookie', async () => {
  const jwt = await buildJwt(TENANT_X, 'consultant');
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/tenants/switch',
    cookies: { cpa_session: jwt },
    payload: { tenantId: TENANT_Y },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json<{
    user: { id: string; email: string };
    activeTenant: { id: string; name: string; role: string };
    availableTenants: Array<{ tenantId: string; role: string; isDefault: boolean }>;
  }>();
  assert.equal(body.user.id, SWITCH_USER);
  assert.equal(body.activeTenant.id, TENANT_Y);
  assert.equal(body.activeTenant.role, 'admin');
  assert.equal(body.availableTenants.length, 2);

  // Verify the new cookie was set
  const setCookie = res.headers['set-cookie'];
  const setCookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
  assert.match(setCookieStr, /cpa_session=[A-Za-z0-9_\-.]+/, 'new session JWT cookie set');
  assert.match(setCookieStr, /HttpOnly/);
  assert.match(setCookieStr, /SameSite=Lax/i);
  await app.close();
});

test('POST /v1/tenants/switch: 404 when target tenant is not in user memberships', async () => {
  const jwt = await buildJwt(TENANT_X, 'consultant');
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/tenants/switch',
    cookies: { cpa_session: jwt },
    payload: { tenantId: '00000000-0000-4000-8000-000000099999' },
  });
  assert.equal(res.statusCode, 404);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'tenant_not_found');
  await app.close();
});

test('POST /v1/tenants/switch: 400 when body is malformed', async () => {
  const jwt = await buildJwt(TENANT_X, 'consultant');
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/tenants/switch',
    cookies: { cpa_session: jwt },
    payload: { tenantId: 'not-a-uuid' },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'invalid_body');
  await app.close();
});
