import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../app.js';

const SESSION_SECRET = process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';

const TENANT_A = '00000000-0000-4000-8000-0000000c0001';
const TENANT_B = '00000000-0000-4000-8000-0000000c0002';
const ADMIN_USER = '00000000-0000-4000-8000-0000000c0010';
const SUBJECT_A1 = '00000000-0000-4000-8000-0000000c0021';
const SUBJECT_A2 = '00000000-0000-4000-8000-0000000c0022';
const SUBJECT_B1 = '00000000-0000-4000-8000-0000000c0023';

before(async () => {
  // Tear down any prior fixtures (idempotent) before re-seeding.
  await privilegedSql`DELETE FROM subject_tenant WHERE id IN (${SUBJECT_A1}, ${SUBJECT_A2}, ${SUBJECT_B1})`;
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await sql`DELETE FROM "user" WHERE id = ${ADMIN_USER}`;
  await sql`DELETE FROM tenant WHERE id IN (${TENANT_A}, ${TENANT_B})`;

  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT_A}, 'Firm A', 'firm-a-st', 'mixed'),
                   (${TENANT_B}, 'Firm B', 'firm-b-st', 'mixed')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${ADMIN_USER}, 'st-admin@example.com', 'microsoft', 'microsoft:st-admin', 'ST Admin')`;
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_A}, ${ADMIN_USER}, 'admin', true)`;

  // Two claimants in firm A and one financier in firm B (cross-firm
  // visibility check: caller in firm A must NOT see firm B's row).
  await privilegedSql`INSERT INTO subject_tenant (id, tenant_id, name, kind)
                       VALUES (${SUBJECT_A1}, ${TENANT_A}, 'Acme Co', 'claimant'),
                              (${SUBJECT_A2}, ${TENANT_A}, 'Beta Inc', 'claimant'),
                              (${SUBJECT_B1}, ${TENANT_B}, 'Other Corp', 'financier')`;
});

after(async () => {
  await privilegedSql`DELETE FROM subject_tenant WHERE id IN (${SUBJECT_A1}, ${SUBJECT_A2}, ${SUBJECT_B1})`;
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await sql`DELETE FROM "user" WHERE id = ${ADMIN_USER}`;
  await sql`DELETE FROM tenant WHERE id IN (${TENANT_A}, ${TENANT_B})`;
  await sql.end();
  await privilegedSql.end();
});

const adminJwt = (): Promise<string> =>
  signSession(
    {
      sub: ADMIN_USER,
      email: 'st-admin@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: TENANT_A,
      activeRole: 'admin',
      availableTenants: [],
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );

test('GET /v1/subject-tenants: 401 without session', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/v1/subject-tenants' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('GET /v1/subject-tenants: returns active firm rows only (RLS)', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/subject-tenants',
    cookies: { cpa_session: await adminJwt() },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json<{ subject_tenants: Array<{ id: string; name: string; kind: string }> }>();
  // Both firm-A subjects, no firm-B row.
  assert.equal(body.subject_tenants.length, 2);
  const ids = body.subject_tenants.map((s) => s.id).sort();
  assert.deepEqual(ids, [SUBJECT_A1, SUBJECT_A2].sort());
  assert.ok(body.subject_tenants.every((s) => s.kind === 'claimant'));
});

test('GET /v1/subject-tenants?kind=financier: empty when none match', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/subject-tenants?kind=financier',
    cookies: { cpa_session: await adminJwt() },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json<{ subject_tenants: unknown[] }>();
  assert.equal(body.subject_tenants.length, 0);
  await app.close();
});
