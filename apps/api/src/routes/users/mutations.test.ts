import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../../app.js';

const SESSION_SECRET = process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';
const TENANT_M = '00000000-0000-4000-8000-0000000a8001';
const ADMIN_M = '00000000-0000-4000-8000-0000000a8002';
const OTHER_USER = '00000000-0000-4000-8000-0000000a8003';
const SECOND_ADMIN = '00000000-0000-4000-8000-0000000a8004';

before(async () => {
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT_M}`;
  await sql`DELETE FROM "user" WHERE id IN (${ADMIN_M}, ${OTHER_USER}, ${SECOND_ADMIN})`;
  await sql`DELETE FROM tenant WHERE id = ${TENANT_M}`;
  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT_M}, 'Mutations Firm', 'mutations-firm', 'mixed')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${ADMIN_M}, 'admin-m@example.com', 'microsoft', 'microsoft:admin-m', 'Admin M'),
                   (${OTHER_USER}, 'other-m@example.com', 'microsoft', 'microsoft:other-m', null),
                   (${SECOND_ADMIN}, 'second-admin@example.com', 'microsoft', 'microsoft:second-admin', null)`;
  // Only ADMIN_M starts as admin in TENANT_M
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_M}, ${ADMIN_M}, 'admin', true)`;
});

after(async () => {
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT_M}`;
  await sql`DELETE FROM "user" WHERE id IN (${ADMIN_M}, ${OTHER_USER}, ${SECOND_ADMIN})`;
  await sql`DELETE FROM tenant WHERE id = ${TENANT_M}`;
  await sql.end();
  await privilegedSql.end();
});

const adminJwt = () =>
  signSession(
    {
      sub: ADMIN_M,
      email: 'admin-m@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: TENANT_M,
      activeRole: 'admin',
      availableTenants: [],
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );

const consultantJwt = () =>
  signSession(
    {
      sub: ADMIN_M,
      email: 'admin-m@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: TENANT_M,
      activeRole: 'consultant',
      availableTenants: [],
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );

// ============================================================
// POST /v1/users
// ============================================================

test('POST /v1/users: 403 for non-admin caller', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/users',
    cookies: { cpa_session: await consultantJwt() },
    payload: { email: 'other-m@example.com', role: 'consultant' },
  });
  assert.equal(res.statusCode, 403);
  await app.close();
});

test('POST /v1/users: 404 when email does not match any user', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/users',
    cookies: { cpa_session: await adminJwt() },
    payload: { email: 'never-existed@example.com', role: 'consultant' },
  });
  assert.equal(res.statusCode, 404);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'user_not_found');
  await app.close();
});

test('POST /v1/users: 201 + creates new tenant_user row on first add', async () => {
  // Cleanup any prior add
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT_M} AND user_id = ${OTHER_USER}`;
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/users',
    cookies: { cpa_session: await adminJwt() },
    payload: { email: 'other-m@example.com', role: 'consultant' },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json<{ id: string; email: string; role: string }>();
  assert.equal(body.id, OTHER_USER);
  assert.equal(body.role, 'consultant');
  await app.close();

  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT_M} AND user_id = ${OTHER_USER}`;
});

test('POST /v1/users: 409 already_member when row already exists', async () => {
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_M}, ${OTHER_USER}, 'consultant', false)`;
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/users',
    cookies: { cpa_session: await adminJwt() },
    payload: { email: 'other-m@example.com', role: 'consultant' },
  });
  assert.equal(res.statusCode, 409);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'already_member');
  await app.close();

  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT_M} AND user_id = ${OTHER_USER}`;
});

// ============================================================
// PATCH /v1/users/:userId
// ============================================================

test('PATCH /v1/users/:userId: updates role for non-admin target', async () => {
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_M}, ${OTHER_USER}, 'consultant', false)`;
  try {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${OTHER_USER}`,
      cookies: { cpa_session: await adminJwt() },
      payload: { role: 'viewer' },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json<{ role: string }>();
    assert.equal(body.role, 'viewer');
    await app.close();
  } finally {
    await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT_M} AND user_id = ${OTHER_USER}`;
  }
});

test('PATCH /v1/users/:userId: 409 last_admin when demoting only admin', async () => {
  // ADMIN_M is the only admin. Try demoting them via the route.
  const app = buildApp();
  const res = await app.inject({
    method: 'PATCH',
    url: `/v1/users/${ADMIN_M}`,
    cookies: { cpa_session: await adminJwt() },
    payload: { role: 'consultant' },
  });
  assert.equal(res.statusCode, 409);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'last_admin');
  await app.close();
});

test('PATCH /v1/users/:userId: allows demote when another admin exists', async () => {
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_M}, ${SECOND_ADMIN}, 'admin', false)`;
  try {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${ADMIN_M}`,
      cookies: { cpa_session: await adminJwt() },
      payload: { role: 'consultant' },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json<{ role: string }>();
    assert.equal(body.role, 'consultant');
    await app.close();
  } finally {
    // Restore ADMIN_M as admin for downstream tests
    await privilegedSql`UPDATE tenant_user SET role = 'admin' WHERE tenant_id = ${TENANT_M} AND user_id = ${ADMIN_M}`;
    await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT_M} AND user_id = ${SECOND_ADMIN}`;
  }
});

// ============================================================
// DELETE /v1/users/:userId
// ============================================================

test('DELETE /v1/users/:userId: 409 last_admin when removing only admin', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'DELETE',
    url: `/v1/users/${ADMIN_M}`,
    cookies: { cpa_session: await adminJwt() },
  });
  assert.equal(res.statusCode, 409);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'last_admin');
  await app.close();
});

test('DELETE /v1/users/:userId: 204 + soft-deletes a non-admin member', async () => {
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_M}, ${OTHER_USER}, 'consultant', false)`;
  try {
    const app = buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/users/${OTHER_USER}`,
      cookies: { cpa_session: await adminJwt() },
    });
    assert.equal(res.statusCode, 204);
    // Verify soft-delete (deleted_at NOT NULL) — privilegedSql bypasses RLS
    const checkRow = await privilegedSql<{ deleted_at: Date | string | null }[]>`
      SELECT deleted_at FROM tenant_user WHERE tenant_id = ${TENANT_M} AND user_id = ${OTHER_USER}
    `;
    assert.notEqual(checkRow[0]?.deleted_at, null, 'soft-delete sets deleted_at');
    await app.close();
  } finally {
    await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT_M} AND user_id = ${OTHER_USER}`;
  }
});
