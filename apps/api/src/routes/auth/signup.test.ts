import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../../app.js';

// ---------------------------------------------------------------------------
// Test constants — P9.1.6.3 namespace (prefix 000000094xxx)
// ---------------------------------------------------------------------------

const TEST_SESSION_SECRET = 'test-signup-session-secret-p9163!!';
const TEST_VERIFICATION_SECRET = 'test-signup-verification-secret-p9163!!';
const TEST_EMAIL = 'signup-test-p9163@example.com';
const TEST_FIRM = 'P9 Test Firm (signup)';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSignupApp() {
  const capturedEmails: { to: string; token: string }[] = [];
  const app = buildApp({
    signup: {
      sessionSecret: TEST_SESSION_SECRET,
      verificationSecret: TEST_VERIFICATION_SECRET,
      cookieName: 'cpa_session',
      cookieSecure: false,
      ttlSeconds: 3600,
      sendVerificationEmail: (to, token) => {
        capturedEmails.push({ to, token });
        return Promise.resolve();
      },
    },
  });
  return { app, capturedEmails };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

before(async () => {
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id IN (
    SELECT id FROM tenant WHERE name = ${TEST_FIRM}
  )`;
  await privilegedSql`DELETE FROM tenant WHERE name = ${TEST_FIRM}`;
  await sql`DELETE FROM "user" WHERE email = ${TEST_EMAIL}`;
});

after(async () => {
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id IN (
    SELECT id FROM tenant WHERE name = ${TEST_FIRM}
  )`;
  await privilegedSql`DELETE FROM tenant WHERE name = ${TEST_FIRM}`;
  await sql`DELETE FROM "user" WHERE email = ${TEST_EMAIL}`;
});

// ---------------------------------------------------------------------------
// Tests — POST /v1/auth/signup
// ---------------------------------------------------------------------------

test('POST /v1/auth/signup: 422 with missing email', async () => {
  const { app } = buildSignupApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { firmName: 'Some Firm' },
  });
  assert.equal(res.statusCode, 422);
  await app.close();
});

test('POST /v1/auth/signup: 422 with missing firmName', async () => {
  const { app } = buildSignupApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { email: TEST_EMAIL },
  });
  assert.equal(res.statusCode, 422);
  await app.close();
});

test('POST /v1/auth/signup: 202 and sends verification email', async () => {
  const { app, capturedEmails } = buildSignupApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { email: TEST_EMAIL, firmName: TEST_FIRM },
  });
  assert.equal(res.statusCode, 202);
  assert.equal(capturedEmails.length, 1);
  assert.equal(capturedEmails[0]!.to, TEST_EMAIL);
  assert.ok(capturedEmails[0]!.token.length > 10, 'verification token must be non-trivial');
  await app.close();
});

// ---------------------------------------------------------------------------
// Tests — POST /v1/auth/verify-email
// ---------------------------------------------------------------------------

test('POST /v1/auth/verify-email: 400 with missing token', async () => {
  const { app } = buildSignupApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/verify-email',
    payload: {},
  });
  assert.equal(res.statusCode, 422);
  await app.close();
});

test('POST /v1/auth/verify-email: 401 with invalid token', async () => {
  const { app } = buildSignupApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/verify-email',
    payload: { token: 'not.a.valid.jwt' },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('POST /v1/auth/verify-email: 200 creates user+tenant and sets session cookie', async () => {
  const { app, capturedEmails } = buildSignupApp();

  // First, trigger the signup to get a real token
  const signupRes = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { email: TEST_EMAIL, firmName: TEST_FIRM },
  });
  assert.equal(signupRes.statusCode, 202);
  const token = capturedEmails[0]!.token;

  // Verify the email
  const verifyRes = await app.inject({
    method: 'POST',
    url: '/v1/auth/verify-email',
    payload: { token },
  });
  assert.equal(verifyRes.statusCode, 200);

  // Session cookie must be set
  const setCookie = verifyRes.headers['set-cookie'] as string | string[];
  const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
  assert.ok(cookieStr?.includes('cpa_session'), 'session cookie must be set');

  await app.close();
});

test('POST /v1/auth/verify-email: creates tenant with trial_status=active and trial_ends_at ~30d', async () => {
  // Reset user/tenant first
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id IN (
    SELECT id FROM tenant WHERE name = ${TEST_FIRM}
  )`;
  await privilegedSql`DELETE FROM tenant WHERE name = ${TEST_FIRM}`;
  await sql`DELETE FROM "user" WHERE email = ${TEST_EMAIL}`;

  const { app, capturedEmails } = buildSignupApp();

  await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { email: TEST_EMAIL, firmName: TEST_FIRM },
  });
  const token = capturedEmails[0]!.token;

  await app.inject({
    method: 'POST',
    url: '/v1/auth/verify-email',
    payload: { token },
  });

  const rows = await sql<{ trial_status: string; billing_mode: string; trial_ends_at: Date }[]>`
    SELECT trial_status, billing_mode, trial_ends_at
      FROM tenant
     WHERE name = ${TEST_FIRM}
  `;
  assert.equal(rows[0]?.trial_status, 'active');
  assert.equal(rows[0]?.billing_mode, 'trial');

  // trial_ends_at should be approximately 30 days from now
  const endsAt = rows[0].trial_ends_at;
  const daysRemaining = (new Date(endsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  assert.ok(daysRemaining > 28, 'trial_ends_at must be at least 28 days from now');
  assert.ok(daysRemaining < 32, 'trial_ends_at must be at most 32 days from now');

  await app.close();
});

test('POST /v1/auth/verify-email: creates tenant_user with role=admin', async () => {
  const rows = await privilegedSql<{ role: string }[]>`
    SELECT tu.role
      FROM tenant_user tu
      JOIN tenant t ON t.id = tu.tenant_id
     WHERE t.name = ${TEST_FIRM}
  `;
  assert.ok(rows.length > 0, 'tenant_user row should exist');
  assert.equal(rows[0]?.role, 'admin');
});

test('POST /v1/auth/verify-email: 409 if token already used (user already exists)', async () => {
  const { app, capturedEmails } = buildSignupApp();

  // Trigger a new signup with the same email — user was created in previous test
  const signupRes = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { email: TEST_EMAIL, firmName: TEST_FIRM },
  });
  assert.equal(signupRes.statusCode, 202);
  const token = capturedEmails[0]!.token;

  // Verify again — should conflict because user already exists
  const verifyRes = await app.inject({
    method: 'POST',
    url: '/v1/auth/verify-email',
    payload: { token },
  });
  assert.equal(verifyRes.statusCode, 409);

  await app.close();
});
