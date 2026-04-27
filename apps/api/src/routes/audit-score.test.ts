import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { signSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../app.js';

const SESSION_SECRET =
  process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';
process.env['SESSION_JWT_SECRET'] = SESSION_SECRET;

const TENANT_A = '00000000-0000-4000-8000-00000000c1301';
const TENANT_B = '00000000-0000-4000-8000-00000000c1302';
const ADMIN_USER = '00000000-0000-4000-8000-00000000c1310';
const SUBJECT_A1 = '00000000-0000-4000-8000-00000000c1321';
const SUBJECT_A2 = '00000000-0000-4000-8000-00000000c1322';
const SUBJECT_B1 = '00000000-0000-4000-8000-00000000c1323';
const EMPLOYEE_A1 = '00000000-0000-4000-8000-00000000c1330';

const cleanup = async (): Promise<void> => {
  await privilegedSql`DELETE FROM subject_tenant_employee WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM subject_tenant WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await sql`DELETE FROM "user" WHERE id = ${ADMIN_USER}`;
  await sql`DELETE FROM tenant WHERE id IN (${TENANT_A}, ${TENANT_B})`;
};

before(async () => {
  await cleanup();
  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT_A}, 'Firm C13 A', 'firm-c13-a', 'mixed'),
                   (${TENANT_B}, 'Firm C13 B', 'firm-c13-b', 'mixed')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${ADMIN_USER}, 'c13-admin@example.com', 'microsoft', 'microsoft:c13-admin', 'C13 Admin')`;
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_A}, ${ADMIN_USER}, 'admin', true)`;
  await privilegedSql`INSERT INTO subject_tenant (id, tenant_id, name, kind)
                       VALUES (${SUBJECT_A1}, ${TENANT_A}, 'Acme Co', 'claimant'),
                              (${SUBJECT_A2}, ${TENANT_A}, 'Sister Co', 'claimant'),
                              (${SUBJECT_B1}, ${TENANT_B}, 'Other Corp', 'claimant')`;
  await privilegedSql`
    INSERT INTO subject_tenant_employee (
      id, subject_tenant_id, tenant_id, email, name, invited_by_user_id
    ) VALUES
      (${EMPLOYEE_A1}, ${SUBJECT_A1}, ${TENANT_A}, 'c13-jane@acme.com', 'Jane', ${ADMIN_USER})
  `;
});

after(async () => {
  await cleanup();
  await sql.end();
  await privilegedSql.end();
});

const signClaimantCookie = async (
  employeeId: string,
  tenantId: string,
  subjectTenantId: string,
): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    tenant_id: tenantId,
    subject_tenant_id: subjectTenantId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(employeeId)
    .setAudience('pwa-claimant')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(new TextEncoder().encode(SESSION_SECRET));
};

const adminConsultantCookie = (): Promise<string> =>
  signSession(
    {
      sub: ADMIN_USER,
      email: 'c13-admin@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: TENANT_A,
      activeRole: 'admin',
      availableTenants: [],
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );

test('GET /v1/audit-score/:id: 200 with placeholder breakdown via claimant cookie', async () => {
  const cookie = await signClaimantCookie(EMPLOYEE_A1, TENANT_A, SUBJECT_A1);
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/audit-score/${SUBJECT_A1}`,
    cookies: { cpa_claimant_session: cookie },
  });
  assert.equal(res.statusCode, 200);

  const body = res.json<{
    total_pts: number;
    max_pts: number;
    rule_breakdown: Array<{ id: string; label: string; earned: number; max: number }>;
    delta_7d: number;
    computed_at: string;
  }>();

  assert.equal(body.total_pts, 78);
  assert.equal(body.max_pts, 100);
  assert.equal(body.delta_7d, 10);
  assert.equal(body.rule_breakdown.length, 10);
  // Spot check: first rule is the 10/10 recent-capture one.
  assert.equal(body.rule_breakdown[0]?.id, 'has_recent_capture');
  assert.equal(body.rule_breakdown[0]?.earned, 10);
  assert.equal(body.rule_breakdown[0]?.max, 10);
  // Sum of earned = total_pts (consistency).
  const sum = body.rule_breakdown.reduce((s, r) => s + r.earned, 0);
  assert.equal(sum, body.total_pts);

  // computed_at is an ISO string and recent.
  const computed = new Date(body.computed_at).getTime();
  assert.ok(Math.abs(Date.now() - computed) < 60_000);

  await app.close();
});

test('GET /v1/audit-score/:id: 200 via consultant cookie', async () => {
  const cookie = await adminConsultantCookie();
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/audit-score/${SUBJECT_A1}`,
    cookies: { cpa_session: cookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json<{ total_pts: number }>();
  assert.equal(body.total_pts, 78);
  await app.close();
});

test('GET /v1/audit-score/:id: 401 with no auth cookie', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/audit-score/${SUBJECT_A1}`,
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('GET /v1/audit-score/:id: 404 cross-firm via claimant cookie', async () => {
  // Claimant cookie is scoped to SUBJECT_A1; SUBJECT_B1 is in TENANT_B.
  const cookie = await signClaimantCookie(EMPLOYEE_A1, TENANT_A, SUBJECT_A1);
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/audit-score/${SUBJECT_B1}`,
    cookies: { cpa_claimant_session: cookie },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('GET /v1/audit-score/:id: 404 cross-firm via consultant cookie', async () => {
  // Consultant is in TENANT_A; SUBJECT_B1 is in TENANT_B.
  const cookie = await adminConsultantCookie();
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/audit-score/${SUBJECT_B1}`,
    cookies: { cpa_session: cookie },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('GET /v1/audit-score/:id: consultant cookie can read sibling claimant in same firm', async () => {
  // Unlike claimant cookies (scoped to one subject), consultant cookies
  // see every claimant in their firm. SUBJECT_A2 is in TENANT_A — 200.
  const cookie = await adminConsultantCookie();
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/audit-score/${SUBJECT_A2}`,
    cookies: { cpa_session: cookie },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});
