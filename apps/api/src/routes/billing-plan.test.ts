import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../app.js';
import type Stripe from 'stripe';

// ---------------------------------------------------------------------------
// Fixtures — P9.2.1 namespace (prefix 000000092xxx)
// ---------------------------------------------------------------------------

const SESSION_SECRET = process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';

const TENANT_P92 = '00000000-0000-4000-8000-000000092001';
const ADMIN_USER_P92 = '00000000-0000-4000-8000-000000092010';

const STRIPE_CUSTOMER_ID = 'cus_test_p92_plan_change';
const STRIPE_SUBSCRIPTION_ID = 'sub_test_p92_plan_change';
const STRIPE_SI_SLA = 'si_test_p92_sla';

// ---------------------------------------------------------------------------
// Mock Stripe
// ---------------------------------------------------------------------------

interface SubscriptionUpdateCall {
  subscriptionId: string;
  params: Stripe.SubscriptionUpdateParams;
}

function makeMockStripe() {
  const updateCalls: SubscriptionUpdateCall[] = [];
  const mock = {
    subscriptions: {
      update: (
        subscriptionId: string,
        params: Stripe.SubscriptionUpdateParams,
      ): Promise<Stripe.Subscription> => {
        updateCalls.push({ subscriptionId, params });
        return Promise.resolve({
          id: subscriptionId,
          status: 'active',
          object: 'subscription',
        } as unknown as Stripe.Subscription);
      },
    },
  } as unknown as Stripe;
  return { mock, updateCalls };
}

const adminSession = (): Promise<string> =>
  signSession(
    {
      sub: ADMIN_USER_P92,
      email: 'p92-admin@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: TENANT_P92,
      activeRole: 'admin',
      availableTenants: [],
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let dbAvailable = false;

const setup = async (): Promise<void> => {
  try {
    await privilegedSql`SELECT 1`;
    dbAvailable = true;
  } catch {
    dbAvailable = false;
    return;
  }

  // Clean up any leftover fixtures
  await privilegedSql`DELETE FROM subscription_item WHERE tenant_id = ${TENANT_P92}`;
  await privilegedSql`DELETE FROM subscription WHERE tenant_id = ${TENANT_P92}`;
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT_P92}`;
  await sql`DELETE FROM "user" WHERE id = ${ADMIN_USER_P92}`;
  await sql`DELETE FROM tenant WHERE id = ${TENANT_P92}`;

  // Create test fixtures
  await sql`
    INSERT INTO tenant (id, name, slug, primary_idp, billing_mode, trial_status, stripe_customer_id)
    VALUES (${TENANT_P92}, 'P92 Plan Test Firm', 'p92-plan-firm', 'mixed', 'paid', 'converted', ${STRIPE_CUSTOMER_ID})
  `;
  await sql`
    INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
    VALUES (${ADMIN_USER_P92}, 'p92-admin@example.com', 'microsoft', 'microsoft:p92-admin', 'P92 Admin')
  `;
  await privilegedSql`
    INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
    VALUES (gen_random_uuid(), ${TENANT_P92}, ${ADMIN_USER_P92}, 'admin', true)
  `;
  // Seed a subscription and SLA subscription_item
  await privilegedSql`
    INSERT INTO subscription (id, tenant_id, stripe_subscription_id, status)
    VALUES (gen_random_uuid(), ${TENANT_P92}, ${STRIPE_SUBSCRIPTION_ID}, 'active')
  `;
  const subRows = await privilegedSql<{ id: string }[]>`
    SELECT id FROM subscription WHERE stripe_subscription_id = ${STRIPE_SUBSCRIPTION_ID}
  `;
  await privilegedSql`
    INSERT INTO subscription_item (id, tenant_id, subscription_id, stripe_subscription_item_id, price_kind)
    VALUES (gen_random_uuid(), ${TENANT_P92}, ${subRows[0]!.id}, ${STRIPE_SI_SLA}, 'sla')
  `;
};

const teardown = async (): Promise<void> => {
  if (!dbAvailable) return;
  await privilegedSql`DELETE FROM subscription_item WHERE tenant_id = ${TENANT_P92}`;
  await privilegedSql`DELETE FROM subscription WHERE tenant_id = ${TENANT_P92}`;
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT_P92}`;
  await sql`DELETE FROM "user" WHERE id = ${ADMIN_USER_P92}`;
  await sql`DELETE FROM tenant WHERE id = ${TENANT_P92}`;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

before(async () => {
  await setup();
});

test('POST /v1/billing/change-plan: 401 without session', async () => {
  if (!dbAvailable) return;
  const { mock } = makeMockStripe();
  const app = buildApp({ billing: { stripe: mock } });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/billing/change-plan',
    payload: { sla_tier: 'silver' },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('POST /v1/billing/change-plan: upgrade to silver — immediate proration', async () => {
  if (!dbAvailable) return;
  const { mock, updateCalls } = makeMockStripe();
  const app = buildApp({ billing: { stripe: mock } });

  const token = await adminSession();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/billing/change-plan',
    headers: { cookie: `cpa_session=${token}` },
    payload: { sla_tier: 'silver' },
  });

  assert.equal(res.statusCode, 200, `change-plan failed: ${res.body}`);
  assert.equal(updateCalls.length, 1, 'Stripe subscription.update must be called once');
  assert.equal(updateCalls[0]?.subscriptionId, STRIPE_SUBSCRIPTION_ID);

  // Upgrade uses immediate proration
  assert.equal(
    updateCalls[0]?.params.proration_behavior,
    'create_prorations',
    'upgrade must use create_prorations',
  );

  // New price ID must be set on the SLA item
  const items = updateCalls[0]?.params.items ?? [];
  assert.ok(items.length > 0, 'items array must be set');
  const slaItem = items.find((i: { id?: string }) => i.id === STRIPE_SI_SLA);
  assert.ok(slaItem, 'SLA subscription_item must be updated');

  await app.close();
});

test('POST /v1/billing/change-plan: downgrade to bronze — at-period-end', async () => {
  if (!dbAvailable) return;
  // First set to silver
  await privilegedSql`
    UPDATE subscription_item SET price_kind = 'sla' WHERE stripe_subscription_item_id = ${STRIPE_SI_SLA}
  `;

  const { mock, updateCalls } = makeMockStripe();
  const app = buildApp({ billing: { stripe: mock } });

  const token = await adminSession();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/billing/change-plan',
    headers: { cookie: `cpa_session=${token}` },
    payload: { sla_tier: 'bronze' },
  });

  assert.equal(res.statusCode, 200, `change-plan downgrade failed: ${res.body}`);
  assert.equal(updateCalls.length, 1);

  // Downgrade uses at_period_end
  assert.equal(
    updateCalls[0]?.params.proration_behavior,
    'none',
    'downgrade must use none (effective at period end)',
  );

  await app.close();
});

test('POST /v1/billing/change-plan: 400 for invalid tier', async () => {
  if (!dbAvailable) return;
  const { mock } = makeMockStripe();
  const app = buildApp({ billing: { stripe: mock } });

  const token = await adminSession();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/billing/change-plan',
    headers: { cookie: `cpa_session=${token}` },
    payload: { sla_tier: 'platinum' }, // invalid
  });

  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST /v1/billing/change-plan: 404 when no SLA subscription item', async () => {
  if (!dbAvailable) return;
  // Temporarily remove the SLA item (subscription stays active so middleware passes)
  await privilegedSql`DELETE FROM subscription_item WHERE stripe_subscription_item_id = ${STRIPE_SI_SLA}`;

  const { mock } = makeMockStripe();
  const app = buildApp({ billing: { stripe: mock } });

  const token = await adminSession();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/billing/change-plan',
    headers: { cookie: `cpa_session=${token}` },
    payload: { sla_tier: 'silver' },
  });

  assert.equal(res.statusCode, 404);

  // Restore
  const subRows = await privilegedSql<{ id: string }[]>`
    SELECT id FROM subscription WHERE stripe_subscription_id = ${STRIPE_SUBSCRIPTION_ID}
  `;
  await privilegedSql`
    INSERT INTO subscription_item (id, tenant_id, subscription_id, stripe_subscription_item_id, price_kind)
    VALUES (gen_random_uuid(), ${TENANT_P92}, ${subRows[0]!.id}, ${STRIPE_SI_SLA}, 'sla')
  `;
  await app.close();
});

after(async () => {
  await teardown();
  await sql.end();
  await privilegedSql.end();
});
