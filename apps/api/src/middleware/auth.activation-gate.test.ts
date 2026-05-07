import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { sql, privilegedSql } from '@cpa/db/client';
import { sessionPlugin, signSession } from '@cpa/auth';
import { registerTenantActivationGate } from './auth.js';

/**
 * Tenant activation gate — P9.1.7.
 *
 * Test namespace: 000000097xxx
 * Tenants cover every billing state the gate must handle.
 */

// ---------------------------------------------------------------------------
// Test UUIDs
// ---------------------------------------------------------------------------

const TENANT_TRIAL_ACTIVE = '00000000-0000-4000-8000-000000097001';
const TENANT_TRIAL_EXPIRED = '00000000-0000-4000-8000-000000097002';
const TENANT_PAID_ACTIVE = '00000000-0000-4000-8000-000000097003';
const TENANT_PAID_PAST_DUE = '00000000-0000-4000-8000-000000097004';
const TENANT_PAID_CANCELLED = '00000000-0000-4000-8000-000000097005';
const TENANT_PAID_INCOMPLETE = '00000000-0000-4000-8000-000000097006';

const SUB_ACTIVE = '00000000-0000-4000-8000-000000097021';
const SUB_PAST_DUE = '00000000-0000-4000-8000-000000097022';
const SUB_CANCELLED = '00000000-0000-4000-8000-000000097023';
const SUB_INCOMPLETE = '00000000-0000-4000-8000-000000097024';

const ALL_TENANTS = [
  TENANT_TRIAL_ACTIVE,
  TENANT_TRIAL_EXPIRED,
  TENANT_PAID_ACTIVE,
  TENANT_PAID_PAST_DUE,
  TENANT_PAID_CANCELLED,
  TENANT_PAID_INCOMPLETE,
];

const TEST_SESSION_SECRET = 'test-gate-session-secret-p9171!!';
const COOKIE_NAME = 'cpa_session';

// ---------------------------------------------------------------------------
// DB setup / teardown
// ---------------------------------------------------------------------------

const cleanup = async (): Promise<void> => {
  // Subscriptions reference tenants — delete first.
  for (const tenantId of ALL_TENANTS) {
    await privilegedSql`DELETE FROM subscription WHERE tenant_id = ${tenantId}`;
  }
  for (const tenantId of ALL_TENANTS) {
    await privilegedSql`DELETE FROM tenant WHERE id = ${tenantId}`;
  }
};

before(async () => {
  await cleanup();

  // Trial tenants
  await privilegedSql`
    INSERT INTO tenant (id, name, slug, primary_idp, billing_mode, trial_status)
    VALUES
      (${TENANT_TRIAL_ACTIVE},  'Gate Trial Active',   'gate-trial-active-p9171',   'mixed', 'trial', 'active'),
      (${TENANT_TRIAL_EXPIRED}, 'Gate Trial Expired',  'gate-trial-expired-p9171',  'mixed', 'trial', 'expired')
  `;

  // Paid tenants (trial_status='converted' since they moved off trial)
  await privilegedSql`
    INSERT INTO tenant (id, name, slug, primary_idp, billing_mode, trial_status)
    VALUES
      (${TENANT_PAID_ACTIVE},    'Gate Paid Active',    'gate-paid-active-p9171',    'mixed', 'paid', 'converted'),
      (${TENANT_PAID_PAST_DUE},  'Gate Paid Past Due',  'gate-paid-pastdue-p9171',   'mixed', 'paid', 'converted'),
      (${TENANT_PAID_CANCELLED}, 'Gate Paid Cancelled', 'gate-paid-cancelled-p9171', 'mixed', 'paid', 'converted'),
      (${TENANT_PAID_INCOMPLETE},'Gate Paid Incomplete','gate-paid-incomplete-p9171','mixed', 'paid', 'converted')
  `;

  // Subscriptions for paid tenants
  await privilegedSql`
    INSERT INTO subscription (id, tenant_id, stripe_subscription_id, status)
    VALUES
      (${SUB_ACTIVE},    ${TENANT_PAID_ACTIVE},    'sub_gate_active_p9171',    'active'),
      (${SUB_PAST_DUE},  ${TENANT_PAID_PAST_DUE},  'sub_gate_pastdue_p9171',   'past_due'),
      (${SUB_CANCELLED}, ${TENANT_PAID_CANCELLED},  'sub_gate_cancelled_p9171', 'cancelled'),
      (${SUB_INCOMPLETE},${TENANT_PAID_INCOMPLETE}, 'sub_gate_incomplete_p9171','incomplete')
  `;
});

after(async () => {
  await cleanup();
  await sql.end();
  await privilegedSql.end();
});

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

/**
 * Minimal Fastify app with cookie + session + gate + two probe routes.
 * Routes are nested inside a child scope so that:
 *   parent preHandler: session (sets req.user)
 *   child preHandler:  gate (reads req.user, gates access)
 * This mirrors the registration order in the real app.ts.
 */
const buildGateApp = (): FastifyInstance => {
  const app = Fastify();
  void app.register(cookie);
  void app.register(sessionPlugin, { secret: TEST_SESSION_SECRET, cookieName: COOKIE_NAME });
  void app.register((instance, _opts, done) => {
    registerTenantActivationGate(instance);
    instance.get('/probe', () => ({ ok: true }));
    instance.post('/probe', () => ({ ok: true }));
    done();
  });
  return app;
};

/** Build a signed session cookie for the given tenantId. */
const makeCookie = async (tenantId: string): Promise<string> => {
  const jwt = await signSession(
    {
      sub: '00000000-0000-4000-8000-000000097010',
      email: 'gate-test@example.com',
      primaryIdp: 'email',
      activeTenantId: tenantId,
      activeRole: 'admin',
      availableTenants: [],
    },
    TEST_SESSION_SECRET,
    { ttlSeconds: 3600 },
  );
  return `${COOKIE_NAME}=${jwt}`;
};

// ---------------------------------------------------------------------------
// Tests — no session
// ---------------------------------------------------------------------------

test('activation gate: no session cookie → probe passes (unauthenticated skip)', async () => {
  const app = buildGateApp();
  const res = await app.inject({ method: 'GET', url: '/probe' });
  assert.equal(res.statusCode, 200);
  await app.close();
});

// ---------------------------------------------------------------------------
// Tests — trial active
// ---------------------------------------------------------------------------

test('activation gate: trial active → GET 200', async () => {
  const app = buildGateApp();
  const res = await app.inject({
    method: 'GET',
    url: '/probe',
    headers: { cookie: await makeCookie(TENANT_TRIAL_ACTIVE) },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test('activation gate: trial active → POST 200', async () => {
  const app = buildGateApp();
  const res = await app.inject({
    method: 'POST',
    url: '/probe',
    headers: { cookie: await makeCookie(TENANT_TRIAL_ACTIVE) },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

// ---------------------------------------------------------------------------
// Tests — trial expired
// ---------------------------------------------------------------------------

test('activation gate: trial expired → GET 402 trial_expired', async () => {
  const app = buildGateApp();
  const res = await app.inject({
    method: 'GET',
    url: '/probe',
    headers: { cookie: await makeCookie(TENANT_TRIAL_EXPIRED) },
  });
  assert.equal(res.statusCode, 402);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'trial_expired');
  await app.close();
});

test('activation gate: trial expired → POST 402', async () => {
  const app = buildGateApp();
  const res = await app.inject({
    method: 'POST',
    url: '/probe',
    headers: { cookie: await makeCookie(TENANT_TRIAL_EXPIRED) },
  });
  assert.equal(res.statusCode, 402);
  await app.close();
});

// ---------------------------------------------------------------------------
// Tests — paid, subscription active
// ---------------------------------------------------------------------------

test('activation gate: paid subscription active → GET 200', async () => {
  const app = buildGateApp();
  const res = await app.inject({
    method: 'GET',
    url: '/probe',
    headers: { cookie: await makeCookie(TENANT_PAID_ACTIVE) },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test('activation gate: paid subscription active → POST 200', async () => {
  const app = buildGateApp();
  const res = await app.inject({
    method: 'POST',
    url: '/probe',
    headers: { cookie: await makeCookie(TENANT_PAID_ACTIVE) },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

// ---------------------------------------------------------------------------
// Tests — paid, subscription past_due
// ---------------------------------------------------------------------------

test('activation gate: paid past_due → GET 200 with X-Billing-Alert header', async () => {
  const app = buildGateApp();
  const res = await app.inject({
    method: 'GET',
    url: '/probe',
    headers: { cookie: await makeCookie(TENANT_PAID_PAST_DUE) },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-billing-alert'], 'past_due');
  await app.close();
});

test('activation gate: paid past_due → POST 200 (writes still allowed)', async () => {
  const app = buildGateApp();
  const res = await app.inject({
    method: 'POST',
    url: '/probe',
    headers: { cookie: await makeCookie(TENANT_PAID_PAST_DUE) },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

// ---------------------------------------------------------------------------
// Tests — paid, subscription cancelled
// ---------------------------------------------------------------------------

test('activation gate: paid cancelled → GET 200 (read-only allowed)', async () => {
  const app = buildGateApp();
  const res = await app.inject({
    method: 'GET',
    url: '/probe',
    headers: { cookie: await makeCookie(TENANT_PAID_CANCELLED) },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test('activation gate: paid cancelled → POST 402 subscription_cancelled (writes blocked)', async () => {
  const app = buildGateApp();
  const res = await app.inject({
    method: 'POST',
    url: '/probe',
    headers: { cookie: await makeCookie(TENANT_PAID_CANCELLED) },
  });
  assert.equal(res.statusCode, 402);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'subscription_cancelled');
  await app.close();
});

// ---------------------------------------------------------------------------
// Tests — paid, subscription incomplete
// ---------------------------------------------------------------------------

test('activation gate: paid incomplete → GET 402 payment_incomplete', async () => {
  const app = buildGateApp();
  const res = await app.inject({
    method: 'GET',
    url: '/probe',
    headers: { cookie: await makeCookie(TENANT_PAID_INCOMPLETE) },
  });
  assert.equal(res.statusCode, 402);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'payment_incomplete');
  await app.close();
});
