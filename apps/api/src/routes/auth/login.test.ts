/**
 * Magic-link login tests.
 *
 * Exercises both endpoints end-to-end against the real DB (`privilegedSql`):
 *   - POST /v1/auth/login         — request a magic link
 *   - GET  /v1/auth/login/callback — consume one
 *
 * Email sending is patched at the module-resolution level via the
 * RESEND_API_KEY env toggle: when unset, the route 503s before
 * touching the @cpa/email dynamic import. When set, the route DOES
 * resolve @cpa/email but the network call inside `sender.send` may
 * throw against a fake key — the route catches and logs that, then
 * still returns the generic 200 (the auth_magic_link row is in the
 * DB by that point and we can drive the callback path directly with
 * the raw token we read back).
 *
 * We avoid intercepting the network module-by-module; instead, we
 * read the row back from the DB and look up its `token_hash` to
 * confirm the lifecycle. To drive the callback we mint our own
 * (rawToken, hash) pair via the same `crypto.createHash('sha256')`
 * path the route uses, then INSERT directly with that hash — that
 * lets us test the callback without exercising the email send.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../../app.js';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_SESSION_SECRET = 'test-magic-link-session-secret-p9163';
const TEST_VERIFICATION_SECRET = 'test-magic-link-verification-secret-p9163';
const TEST_EMAIL = 'magic-link-test-p9163@example.com';
const TEST_EMAIL_UNKNOWN = 'magic-link-unknown-p9163@example.com';
const TEST_FIRM = 'P9 Test Firm (magic-link)';
const TEST_TENANT_ID = 'a1111111-1111-1111-1111-111111111111';
const TEST_USER_ID = 'b1111111-1111-1111-1111-111111111111';

// Some kind of fake key. The route will resolve @cpa/email but the
// network call inside Resend will fail — we catch that and confirm
// the auth_magic_link row was still persisted (which is the
// observable behaviour the test cares about).
const FAKE_RESEND_KEY = 're_test_p9163_fake_for_unit_tests';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function buildLoginApp(): { app: ReturnType<typeof buildApp> } {
  const app = buildApp({
    signup: {
      sessionSecret: TEST_SESSION_SECRET,
      verificationSecret: TEST_VERIFICATION_SECRET,
      cookieName: 'cpa_session',
      cookieSecure: false,
      ttlSeconds: 3600,
    },
  });
  return { app };
}

async function cleanup(): Promise<void> {
  await privilegedSql`DELETE FROM auth_magic_link WHERE user_id = ${TEST_USER_ID}`;
  await privilegedSql`DELETE FROM tenant_user WHERE user_id = ${TEST_USER_ID}`;
  await privilegedSql`DELETE FROM tenant WHERE id = ${TEST_TENANT_ID}`;
  await sql`DELETE FROM "user" WHERE id = ${TEST_USER_ID} OR email = ${TEST_EMAIL}`;
}

async function seedUserAndTenant(): Promise<void> {
  await cleanup();
  await privilegedSql`
    INSERT INTO "user" (id, primary_idp, external_id, email, display_name)
    VALUES (${TEST_USER_ID}, 'email', ${TEST_EMAIL}, ${TEST_EMAIL}, 'Magic Link Tester')
  `;
  await privilegedSql`
    INSERT INTO tenant (id, name, slug, primary_idp, trial_status, billing_mode)
    VALUES (${TEST_TENANT_ID}, ${TEST_FIRM}, 'p9163-magic-link', 'mixed', 'active', 'trial')
  `;
  await privilegedSql`
    INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
    VALUES (gen_random_uuid(), ${TEST_TENANT_ID}, ${TEST_USER_ID}, 'admin', true)
  `;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

before(async () => {
  await seedUserAndTenant();
});

after(async () => {
  await cleanup();
  delete process.env['RESEND_API_KEY'];
});

// ---------------------------------------------------------------------------
// POST /v1/auth/login
// ---------------------------------------------------------------------------

test('POST /v1/auth/login: 503 when RESEND_API_KEY unset', async () => {
  delete process.env['RESEND_API_KEY'];
  const { app } = buildLoginApp();
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: TEST_EMAIL },
    });
    assert.equal(res.statusCode, 503);
    const body: { error: string } = res.json();
    assert.equal(body.error, 'email_transport_disabled');
  } finally {
    await app.close();
  }
});

test('POST /v1/auth/login: 422 on missing email', async () => {
  process.env['RESEND_API_KEY'] = FAKE_RESEND_KEY;
  const { app } = buildLoginApp();
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {},
    });
    assert.equal(res.statusCode, 422);
  } finally {
    await app.close();
  }
});

test('POST /v1/auth/login: 200 generic message on known email + persists row', async () => {
  process.env['RESEND_API_KEY'] = FAKE_RESEND_KEY;
  await privilegedSql`DELETE FROM auth_magic_link WHERE user_id = ${TEST_USER_ID}`;
  const { app } = buildLoginApp();
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: TEST_EMAIL },
    });
    assert.equal(res.statusCode, 200);
    const body: { message: string } = res.json();
    assert.ok(body.message.includes('If that email is registered'));

    const rows = await privilegedSql<{ id: string; token_hash: string }[]>`
      SELECT id::text, token_hash FROM auth_magic_link WHERE user_id = ${TEST_USER_ID}
    `;
    assert.equal(rows.length, 1, 'auth_magic_link row should be persisted');
    assert.ok(rows[0]?.token_hash, 'token_hash should be set');
  } finally {
    await app.close();
  }
});

test('POST /v1/auth/login: 200 generic message on UNKNOWN email + no row written (existence-leak defense)', async () => {
  process.env['RESEND_API_KEY'] = FAKE_RESEND_KEY;
  const { app } = buildLoginApp();
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: TEST_EMAIL_UNKNOWN },
    });
    // Same status + body shape as the known-email case.
    assert.equal(res.statusCode, 200);
    const body: { message: string } = res.json();
    assert.ok(body.message.includes('If that email is registered'));

    // No row should have been written for a non-existent user.
    const rows = await privilegedSql<{ c: string }[]>`
      SELECT count(*)::text AS c
        FROM auth_magic_link aml
        JOIN "user" u ON u.id = aml.user_id
       WHERE u.email = ${TEST_EMAIL_UNKNOWN}
    `;
    assert.equal(Number(rows[0]?.c ?? 0), 0);
  } finally {
    await app.close();
  }
});

test('POST /v1/auth/login: rate-limit enforces 5/hour per user', async () => {
  process.env['RESEND_API_KEY'] = FAKE_RESEND_KEY;
  await privilegedSql`DELETE FROM auth_magic_link WHERE user_id = ${TEST_USER_ID}`;
  // Seed 5 prior sends so the next request crosses the threshold.
  for (let i = 0; i < 5; i++) {
    await privilegedSql`
      INSERT INTO auth_magic_link (user_id, token_hash, expires_at)
      VALUES (
        ${TEST_USER_ID},
        ${'pre-' + i.toString() + '-' + crypto.randomBytes(8).toString('hex')},
        ${new Date(Date.now() + 15 * 60 * 1000).toISOString()}
      )
    `;
  }

  const { app } = buildLoginApp();
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: TEST_EMAIL },
    });
    // Still 200 with the same generic body — but the route should NOT
    // have written a 6th row.
    assert.equal(res.statusCode, 200);
    const rows = await privilegedSql<{ c: string }[]>`
      SELECT count(*)::text AS c
        FROM auth_magic_link
       WHERE user_id = ${TEST_USER_ID}
         AND sent_at > (now() - interval '1 hour')
    `;
    assert.equal(Number(rows[0]?.c ?? 0), 5, 'rate-limit must block the 6th send');
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// GET /v1/auth/login/callback
// ---------------------------------------------------------------------------

test('GET /v1/auth/login/callback: 401 on missing token', async () => {
  process.env['RESEND_API_KEY'] = FAKE_RESEND_KEY;
  const { app } = buildLoginApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/login/callback',
    });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('GET /v1/auth/login/callback: 401 on unknown token', async () => {
  process.env['RESEND_API_KEY'] = FAKE_RESEND_KEY;
  const { app } = buildLoginApp();
  try {
    const bogusToken = crypto.randomBytes(32).toString('base64url');
    const res = await app.inject({
      method: 'GET',
      url: `/v1/auth/login/callback?token=${encodeURIComponent(bogusToken)}`,
    });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('GET /v1/auth/login/callback: 401 on expired token', async () => {
  process.env['RESEND_API_KEY'] = FAKE_RESEND_KEY;
  await privilegedSql`DELETE FROM auth_magic_link WHERE user_id = ${TEST_USER_ID}`;
  const rawToken = crypto.randomBytes(32).toString('base64url');
  await privilegedSql`
    INSERT INTO auth_magic_link (user_id, token_hash, expires_at)
    VALUES (
      ${TEST_USER_ID},
      ${hashToken(rawToken)},
      ${new Date(Date.now() - 60 * 1000).toISOString()}
    )
  `;

  const { app } = buildLoginApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/auth/login/callback?token=${encodeURIComponent(rawToken)}`,
    });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('GET /v1/auth/login/callback: 401 on already-consumed token', async () => {
  process.env['RESEND_API_KEY'] = FAKE_RESEND_KEY;
  await privilegedSql`DELETE FROM auth_magic_link WHERE user_id = ${TEST_USER_ID}`;
  const rawToken = crypto.randomBytes(32).toString('base64url');
  await privilegedSql`
    INSERT INTO auth_magic_link (user_id, token_hash, expires_at, consumed_at)
    VALUES (
      ${TEST_USER_ID},
      ${hashToken(rawToken)},
      ${new Date(Date.now() + 15 * 60 * 1000).toISOString()},
      now()
    )
  `;

  const { app } = buildLoginApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/auth/login/callback?token=${encodeURIComponent(rawToken)}`,
    });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('GET /v1/auth/login/callback: 302 happy-path with session cookie', async () => {
  process.env['RESEND_API_KEY'] = FAKE_RESEND_KEY;
  await privilegedSql`DELETE FROM auth_magic_link WHERE user_id = ${TEST_USER_ID}`;
  const rawToken = crypto.randomBytes(32).toString('base64url');
  await privilegedSql`
    INSERT INTO auth_magic_link (user_id, token_hash, expires_at)
    VALUES (
      ${TEST_USER_ID},
      ${hashToken(rawToken)},
      ${new Date(Date.now() + 15 * 60 * 1000).toISOString()}
    )
  `;

  const { app } = buildLoginApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/auth/login/callback?token=${encodeURIComponent(rawToken)}`,
    });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/subject-tenants');

    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
    assert.ok(cookieStr.includes('cpa_session='), 'session cookie must be set');
    assert.ok(cookieStr.includes('HttpOnly'), 'cookie must be HttpOnly');
    assert.ok(cookieStr.includes('SameSite=Lax'), 'cookie must be SameSite=Lax');

    // Row must now show consumed_at.
    const rows = await privilegedSql<{ consumed_at: Date | null }[]>`
      SELECT consumed_at FROM auth_magic_link WHERE token_hash = ${hashToken(rawToken)}
    `;
    assert.ok(rows[0]?.consumed_at, 'consumed_at must be set after callback');
  } finally {
    await app.close();
  }
});

test('GET /v1/auth/login/callback: respects sanitised next param', async () => {
  process.env['RESEND_API_KEY'] = FAKE_RESEND_KEY;
  await privilegedSql`DELETE FROM auth_magic_link WHERE user_id = ${TEST_USER_ID}`;
  const rawToken = crypto.randomBytes(32).toString('base64url');
  await privilegedSql`
    INSERT INTO auth_magic_link (user_id, token_hash, expires_at)
    VALUES (
      ${TEST_USER_ID},
      ${hashToken(rawToken)},
      ${new Date(Date.now() + 15 * 60 * 1000).toISOString()}
    )
  `;

  const { app } = buildLoginApp();
  try {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/auth/login/callback?token=${encodeURIComponent(rawToken)}&next=${encodeURIComponent('/claims')}`,
    });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/claims');
  } finally {
    await app.close();
  }
});

test('GET /v1/auth/login/callback: rejects open-redirect next param', async () => {
  process.env['RESEND_API_KEY'] = FAKE_RESEND_KEY;
  await privilegedSql`DELETE FROM auth_magic_link WHERE user_id = ${TEST_USER_ID}`;
  const rawToken = crypto.randomBytes(32).toString('base64url');
  await privilegedSql`
    INSERT INTO auth_magic_link (user_id, token_hash, expires_at)
    VALUES (
      ${TEST_USER_ID},
      ${hashToken(rawToken)},
      ${new Date(Date.now() + 15 * 60 * 1000).toISOString()}
    )
  `;

  const { app } = buildLoginApp();
  try {
    const res = await app.inject({
      method: 'GET',
      // Protocol-relative URL → would redirect off-origin without sanitisation.
      url: `/v1/auth/login/callback?token=${encodeURIComponent(rawToken)}&next=${encodeURIComponent('//evil.example.com/x')}`,
    });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/subject-tenants');
  } finally {
    await app.close();
  }
});

test('GET /v1/auth/login/callback: race-safe — only one concurrent caller wins', async () => {
  process.env['RESEND_API_KEY'] = FAKE_RESEND_KEY;
  await privilegedSql`DELETE FROM auth_magic_link WHERE user_id = ${TEST_USER_ID}`;
  const rawToken = crypto.randomBytes(32).toString('base64url');
  await privilegedSql`
    INSERT INTO auth_magic_link (user_id, token_hash, expires_at)
    VALUES (
      ${TEST_USER_ID},
      ${hashToken(rawToken)},
      ${new Date(Date.now() + 15 * 60 * 1000).toISOString()}
    )
  `;

  const { app } = buildLoginApp();
  try {
    const url = `/v1/auth/login/callback?token=${encodeURIComponent(rawToken)}`;
    const results = await Promise.all([
      app.inject({ method: 'GET', url }),
      app.inject({ method: 'GET', url }),
      app.inject({ method: 'GET', url }),
    ]);
    const successes = results.filter((r) => r.statusCode === 302).length;
    const failures = results.filter((r) => r.statusCode === 401).length;
    assert.equal(successes, 1, 'exactly one concurrent caller must succeed');
    assert.equal(failures, 2, 'the other two must 401');
  } finally {
    await app.close();
  }
});
