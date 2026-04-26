import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../../app.js';

const SESSION_SECRET = process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';
const TENANT_LIST = '00000000-0000-4000-8000-0000000a7001';
const ADMIN_USER = '00000000-0000-4000-8000-0000000a7002';
const CONSULTANT_USER = '00000000-0000-4000-8000-0000000a7003';

before(async () => {
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT_LIST}`;
  await sql`DELETE FROM "user" WHERE id IN (${ADMIN_USER}, ${CONSULTANT_USER})`;
  await sql`DELETE FROM tenant WHERE id = ${TENANT_LIST}`;
  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT_LIST}, 'List Firm', 'list-firm-test', 'mixed')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${ADMIN_USER}, 'list-admin@example.com', 'microsoft', 'microsoft:list-admin', 'List Admin'),
                   (${CONSULTANT_USER}, 'list-consultant@example.com', 'microsoft', 'microsoft:list-consultant', null)`;
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_LIST}, ${ADMIN_USER}, 'admin', true),
                              (gen_random_uuid(), ${TENANT_LIST}, ${CONSULTANT_USER}, 'consultant', false)`;
});

after(async () => {
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT_LIST}`;
  await sql`DELETE FROM "user" WHERE id IN (${ADMIN_USER}, ${CONSULTANT_USER})`;
  await sql`DELETE FROM tenant WHERE id = ${TENANT_LIST}`;
  await sql.end();
  await privilegedSql.end();
});

const adminJwt = () =>
  signSession(
    {
      sub: ADMIN_USER,
      email: 'list-admin@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: TENANT_LIST,
      activeRole: 'admin',
      availableTenants: [],
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );

const consultantJwt = () =>
  signSession(
    {
      sub: CONSULTANT_USER,
      email: 'list-consultant@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: TENANT_LIST,
      activeRole: 'consultant',
      availableTenants: [],
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );

test('GET /v1/users: 401 without session', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/v1/users' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('GET /v1/users: 403 when caller is not admin', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/users',
    cookies: { cpa_session: await consultantJwt() },
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test('GET /v1/users: returns active members for admin caller', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/users',
    cookies: { cpa_session: await adminJwt() },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json<{
    users: Array<{
      id: string;
      email: string;
      role: string;
      isDefault: boolean;
      addedAt: string;
    }>;
  }>();
  assert.equal(body.users.length, 2);
  const admin = body.users.find((u) => u.id === ADMIN_USER);
  const consultant = body.users.find((u) => u.id === CONSULTANT_USER);
  assert.ok(admin && consultant);
  assert.equal(admin?.role, 'admin');
  assert.equal(admin?.isDefault, true);
  assert.equal(consultant?.role, 'consultant');
  await app.close();
});

test('GET /v1/users/:userId: returns single user', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/users/${CONSULTANT_USER}`,
    cookies: { cpa_session: await adminJwt() },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json<{ id: string; email: string; role: string }>();
  assert.equal(body.id, CONSULTANT_USER);
  assert.equal(body.email, 'list-consultant@example.com');
  assert.equal(body.role, 'consultant');
  await app.close();
});

test('GET /v1/users/:userId: 404 when user not in this firm', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/users/00000000-0000-4000-8000-000000099998',
    cookies: { cpa_session: await adminJwt() },
  });
  assert.equal(res.statusCode, 404);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'user_not_found');
  await app.close();
});
