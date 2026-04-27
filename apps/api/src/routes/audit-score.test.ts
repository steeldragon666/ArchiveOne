import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../app.js';

const SESSION_SECRET = process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';

// Pinned UUIDs — the 0d04 segment groups all D3-route fixtures.
const TENANT_A = '00000000-0000-4000-8000-0000000d0401';
const TENANT_B = '00000000-0000-4000-8000-0000000d0402';
const ADMIN_A = '00000000-0000-4000-8000-0000000d0410';
const ADMIN_B = '00000000-0000-4000-8000-0000000d0411';
const SUBJECT_A = '00000000-0000-4000-8000-0000000d0421';
const SUBJECT_B = '00000000-0000-4000-8000-0000000d0422';

const cleanup = async (): Promise<void> => {
  await privilegedSql`
    DELETE FROM audit_score_snapshot WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})
  `;
  await privilegedSql`
    DELETE FROM subject_tenant WHERE id IN (${SUBJECT_A}, ${SUBJECT_B})
  `;
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await sql`DELETE FROM "user" WHERE id IN (${ADMIN_A}, ${ADMIN_B})`;
  await sql`DELETE FROM tenant WHERE id IN (${TENANT_A}, ${TENANT_B})`;
};

before(async () => {
  await cleanup();
  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT_A}, 'Firm A D04', 'firm-a-d04', 'mixed'),
                   (${TENANT_B}, 'Firm B D04', 'firm-b-d04', 'mixed')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${ADMIN_A}, 'd04-a@example.com', 'microsoft', 'microsoft:d04-a', 'D04 A'),
                   (${ADMIN_B}, 'd04-b@example.com', 'microsoft', 'microsoft:d04-b', 'D04 B')`;
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_A}, ${ADMIN_A}, 'admin', true),
                              (gen_random_uuid(), ${TENANT_B}, ${ADMIN_B}, 'admin', true)`;
  await privilegedSql`INSERT INTO subject_tenant (id, tenant_id, name, kind)
                       VALUES (${SUBJECT_A}, ${TENANT_A}, 'Acme A', 'claimant'),
                              (${SUBJECT_B}, ${TENANT_B}, 'Acme B', 'claimant')`;
});

beforeEach(async () => {
  await privilegedSql`
    DELETE FROM audit_score_snapshot
     WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})
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
  tenantId: string,
): Promise<string> =>
  signSession(
    {
      sub: userId,
      email,
      primaryIdp: 'microsoft',
      activeTenantId: tenantId,
      activeRole: 'admin',
      availableTenants: [],
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );

const adminAJwt = (): Promise<string> => jwtFor(ADMIN_A, 'd04-a@example.com', TENANT_A);

test('GET /v1/audit-score/:claimant_id: 401 without session', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/audit-score/${SUBJECT_A}`,
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('GET /v1/audit-score/:claimant_id: 404 for cross-firm claimant', async () => {
  const app = buildApp();
  const jwt = await adminAJwt();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/audit-score/${SUBJECT_B}`,
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 404);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'claimant_not_found');
  await app.close();
});

test('GET /v1/audit-score/:claimant_id: 200 + cold-start triggers recompute', async () => {
  const app = buildApp();
  const jwt = await adminAJwt();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/audit-score/${SUBJECT_A}`,
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json<{
    total_pts: number;
    max_pts: number;
    rule_breakdown: Array<{ id: string; earned: number; max: number }>;
    delta_7d: number;
    computed_at: string;
  }>();
  assert.equal(body.max_pts, 100);
  assert.ok(typeof body.total_pts === 'number');
  assert.equal(body.rule_breakdown.length, 10);
  assert.equal(body.delta_7d, 0);
  assert.match(body.computed_at, /^\d{4}-\d{2}-\d{2}T/);

  // A snapshot row should now exist.
  const rows = await privilegedSql<{ id: string }[]>`
    SELECT id FROM audit_score_snapshot WHERE subject_tenant_id = ${SUBJECT_A}
  `;
  assert.equal(rows.length, 1);

  await app.close();
});

test('GET /v1/audit-score/:claimant_id: 200 reads latest snapshot when present', async () => {
  // Seed two snapshots; route must return the newer one.
  await privilegedSql`
    INSERT INTO audit_score_snapshot
      (id, tenant_id, subject_tenant_id, total_pts, max_pts, rule_breakdown, computed_at)
    VALUES
      (gen_random_uuid(), ${TENANT_A}, ${SUBJECT_A}, 25, 100, '[]'::jsonb, NOW() - INTERVAL '2 days'),
      (gen_random_uuid(), ${TENANT_A}, ${SUBJECT_A}, 75, 100, '[]'::jsonb, NOW())
  `;

  const app = buildApp();
  const jwt = await adminAJwt();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/audit-score/${SUBJECT_A}`,
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json<{ total_pts: number; delta_7d: number }>();
  assert.equal(body.total_pts, 75);
  // D3: delta_7d is hard-coded 0 — D4 wires up the real comparison.
  assert.equal(body.delta_7d, 0);

  // No new snapshot was written (route did NOT trigger recompute).
  const rows = await privilegedSql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM audit_score_snapshot WHERE subject_tenant_id = ${SUBJECT_A}
  `;
  assert.equal(rows[0]?.n, 2);

  await app.close();
});
