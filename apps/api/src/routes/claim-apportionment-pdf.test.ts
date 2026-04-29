import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../app.js';

/**
 * Integration tests for GET /v1/claims/:id/apportionment.pdf (C9).
 *
 * Same shape as `claim-pdf.test.ts` (C7's summary endpoint): cross-firm
 * isolation, role gating, and stream headers are the load-bearing
 * assertions; PDF correctness is exercised in
 * `packages/documents/src/apportionment-report.test.ts`.
 *
 * Fixtures: separate UUID block (`c9d0…`) so cleanup in this file
 * doesn't collide with C7's `c7d0…` fixtures. Both test files run
 * against the same Docker postgres container in CI.
 *
 * Today's reality (no events => everything unmapped): the rendered
 * report is the all-unmapped variant — total_apportioned === 0,
 * total_unmapped === total_expenditure. This is exactly the data the
 * route's projection produces today; we assert PDF magic bytes (the
 * route returns a real PDF, not an error) without inspecting the
 * specific cell content.
 */

const SESSION_SECRET = process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';

// Pinned UUIDs — c9d0 segment groups all C9-route fixtures.
const TENANT_A = '00000000-0000-4000-8000-0000c9d00001';
const TENANT_B = '00000000-0000-4000-8000-0000c9d00002';
const ADMIN_A = '00000000-0000-4000-8000-0000c9d00010';
const ADMIN_B = '00000000-0000-4000-8000-0000c9d00011';
const VIEWER_A = '00000000-0000-4000-8000-0000c9d00012';
const SUBJECT_A = '00000000-0000-4000-8000-0000c9d00021';
const SUBJECT_B = '00000000-0000-4000-8000-0000c9d00022';
const PROJECT_A = '00000000-0000-4000-8000-0000c9d00031';
const CLAIM_A = '00000000-0000-4000-8000-0000c9d00041';
const CLAIM_B = '00000000-0000-4000-8000-0000c9d00042';
const EXPENDITURE_A1 = '00000000-0000-4000-8000-0000c9d00051';
const EXPENDITURE_A2 = '00000000-0000-4000-8000-0000c9d00052';
const EXPENDITURE_A3 = '00000000-0000-4000-8000-0000c9d00053';

const cleanup = async (): Promise<void> => {
  await privilegedSql`DELETE FROM expenditure WHERE id IN (${EXPENDITURE_A1}, ${EXPENDITURE_A2}, ${EXPENDITURE_A3})`;
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
            VALUES (${TENANT_A}, 'Firm A C9', 'firm-a-c9', 'mixed'),
                   (${TENANT_B}, 'Firm B C9', 'firm-b-c9', 'mixed')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
            VALUES (${ADMIN_A}, 'c9-admin-a@example.com', 'microsoft', 'microsoft:c9-admin-a', 'C9 Admin A'),
                   (${ADMIN_B}, 'c9-admin-b@example.com', 'microsoft', 'microsoft:c9-admin-b', 'C9 Admin B'),
                   (${VIEWER_A}, 'c9-viewer-a@example.com', 'microsoft', 'microsoft:c9-viewer-a', 'C9 Viewer A')`;
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_A}, ${ADMIN_A}, 'admin', true),
                              (gen_random_uuid(), ${TENANT_B}, ${ADMIN_B}, 'admin', true),
                              (gen_random_uuid(), ${TENANT_A}, ${VIEWER_A}, 'viewer', true)`;
  await privilegedSql`INSERT INTO subject_tenant (id, tenant_id, name, kind)
                       VALUES (${SUBJECT_A}, ${TENANT_A}, 'Acme A', 'claimant'),
                              (${SUBJECT_B}, ${TENANT_B}, 'Acme B', 'claimant')`;
  await privilegedSql`INSERT INTO project (id, tenant_id, subject_tenant_id, name, description, started_at)
                       VALUES (${PROJECT_A}, ${TENANT_A}, ${SUBJECT_A}, 'C9 Project', 'C9 test project', '2026-07-01T00:00:00Z')`;
  await privilegedSql`INSERT INTO claim (id, tenant_id, subject_tenant_id, fiscal_year, stage)
                       VALUES (${CLAIM_A}, ${TENANT_A}, ${SUBJECT_A}, 2027, 'narrative_drafting'),
                              (${CLAIM_B}, ${TENANT_B}, ${SUBJECT_B}, 2027, 'narrative_drafting')`;
  // Three expenditures across all source kinds — exercises the kind-
  // collapse logic in `classifyKind` and makes the rendered detail
  // table non-empty.
  await privilegedSql`INSERT INTO expenditure (id, tenant_id, subject_tenant_id, source, source_external_id, vendor_name, reference, expenditure_date, total_amount, currency)
                       VALUES (${EXPENDITURE_A1}, ${TENANT_A}, ${SUBJECT_A}, 'xero_invoice', 'INV-A1', 'Bio Supplies Co', 'INV-2026-0042', '2026-08-12', 5000, 'AUD'),
                              (${EXPENDITURE_A2}, ${TENANT_A}, ${SUBJECT_A}, 'xero_bank_tx', 'BT-A2', 'Sensor Tech Ltd', 'BT-9988', '2026-09-03', 12000, 'AUD'),
                              (${EXPENDITURE_A3}, ${TENANT_A}, ${SUBJECT_A}, 'xero_receipt', 'RC-A3', 'Travel Co', NULL, '2026-10-21', 800, 'AUD')`;
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

test('GET /v1/claims/:id/apportionment.pdf: 401 without session', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM_A}/apportionment.pdf`,
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('GET /v1/claims/:id/apportionment.pdf: 200 happy path (admin)', async () => {
  const app = buildApp();
  const jwt = await jwtFor(ADMIN_A, 'c9-admin-a@example.com', TENANT_A, 'admin');
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM_A}/apportionment.pdf`,
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

test('GET /v1/claims/:id/apportionment.pdf: 200 with viewer role', async () => {
  const app = buildApp();
  const jwt = await jwtFor(VIEWER_A, 'c9-viewer-a@example.com', TENANT_A, 'viewer');
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM_A}/apportionment.pdf`,
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test('GET /v1/claims/:id/apportionment.pdf: 404 cross-firm (TENANT_B caller)', async () => {
  // Positive control: ADMIN_B can fetch their own claim, but not CLAIM_A.
  const app = buildApp();
  const jwt = await jwtFor(ADMIN_B, 'c9-admin-b@example.com', TENANT_B, 'admin');
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM_A}/apportionment.pdf`,
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 404);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'claim_not_found');
  await app.close();
});

test('GET /v1/claims/:id/apportionment.pdf: 404 nonexistent claim', async () => {
  const app = buildApp();
  const jwt = await jwtFor(ADMIN_A, 'c9-admin-a@example.com', TENANT_A, 'admin');
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/00000000-0000-4000-8000-000000000000/apportionment.pdf`,
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('GET /v1/claims/:id/apportionment.pdf: 200 sets streaming headers', async () => {
  const app = buildApp();
  const jwt = await jwtFor(ADMIN_A, 'c9-admin-a@example.com', TENANT_A, 'admin');
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM_A}/apportionment.pdf`,
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  const disp = res.headers['content-disposition'];
  assert.ok(disp, 'Content-Disposition header missing');
  // Sanitised filename — `firm-a-c9` is the slug-collapsed firm name,
  // 2027 is the FY. The regex anchors both ends so any hidden
  // disposition-parameter drift surfaces immediately.
  assert.match(String(disp), /^attachment; filename="apportionment-2027-firm-a-c9\.pdf"$/);
  assert.equal(res.headers['cache-control'], 'private, no-store');
  await app.close();
});
