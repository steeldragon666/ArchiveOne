import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { privilegedSql, sql } from '@cpa/db/client';
import { computePaidQuantity, syncMobileQuantity } from './mobile-quantity-sync.js';

/**
 * Mobile bulk-discount quantity sync — P9.1.10.
 *
 * Test namespace: 000000100xxx
 * Fixtures:
 *   TENANT       = ...100001
 *   SUBJECTS     = ...100011–100019  (nine claimants, one per potential mobile seat)
 *   SUBSCRIPTION = ...100021
 *   SUB_ITEM     = ...100031  (price_kind = 'mobile')
 *   NO_SI_TENANT = ...100099  (tenant with no mobile subscription_item)
 */

const TENANT = '00000000-0000-4000-8000-000000100001';
const SUBJECTS = [
  '00000000-0000-4000-8000-000000100011',
  '00000000-0000-4000-8000-000000100012',
  '00000000-0000-4000-8000-000000100013',
  '00000000-0000-4000-8000-000000100014',
  '00000000-0000-4000-8000-000000100015',
  '00000000-0000-4000-8000-000000100016',
  '00000000-0000-4000-8000-000000100017',
  '00000000-0000-4000-8000-000000100018',
  '00000000-0000-4000-8000-000000100019',
];
const SUBSCRIPTION = '00000000-0000-4000-8000-000000100021';
const SUB_ITEM = '00000000-0000-4000-8000-000000100031';
const NO_SI_TENANT = '00000000-0000-4000-8000-000000100099';

const STRIPE_SI_ID = 'si_test_p91910_mobile';

// ---------------------------------------------------------------------------
// Stripe mock helpers
// ---------------------------------------------------------------------------

interface MockUpdateCall {
  subscriptionItemId: string;
  params: Stripe.SubscriptionItemUpdateParams;
}

function makeMockStripe(onCall?: (call: MockUpdateCall) => void): {
  stripe: Stripe;
  calls: MockUpdateCall[];
} {
  const calls: MockUpdateCall[] = [];
  const stripe = {
    subscriptionItems: {
      update: (subscriptionItemId: string, params: Stripe.SubscriptionItemUpdateParams) => {
        const call: MockUpdateCall = { subscriptionItemId, params };
        calls.push(call);
        if (onCall) onCall(call);
        return Promise.resolve({
          id: subscriptionItemId,
          object: 'subscription_item',
          quantity: params.quantity,
        });
      },
    },
  } as unknown as Stripe;
  return { stripe, calls };
}

// ---------------------------------------------------------------------------
// DB setup / teardown
// ---------------------------------------------------------------------------

const cleanup = async (): Promise<void> => {
  await privilegedSql`DELETE FROM claimant_mobile_subscription WHERE tenant_id IN (${TENANT})`;
  await privilegedSql`DELETE FROM subscription_item WHERE id = ${SUB_ITEM}`;
  await privilegedSql`DELETE FROM subscription WHERE id = ${SUBSCRIPTION}`;
  await privilegedSql`DELETE FROM audit_score_snapshot WHERE subject_tenant_id IN (SELECT id FROM subject_tenant WHERE tenant_id = ${TENANT})`;
  await privilegedSql`DELETE FROM subject_tenant WHERE tenant_id = ${TENANT}`;
  await sql`DELETE FROM tenant WHERE id IN (${TENANT}, ${NO_SI_TENANT})`;
};

before(async () => {
  await cleanup();

  await sql`
    INSERT INTO tenant (id, name, slug, primary_idp, billing_mode, trial_status)
    VALUES (${TENANT}, 'Mobile Sync Firm', 'mobile-sync-p91910', 'mixed', 'paid', 'converted')
  `;

  // NO_SI_TENANT: a tenant that has no mobile subscription_item (for error test)
  await sql`
    INSERT INTO tenant (id, name, slug, primary_idp, billing_mode, trial_status)
    VALUES (${NO_SI_TENANT}, 'No SI Firm', 'no-si-p91910', 'mixed', 'paid', 'converted')
  `;

  // Nine claimant subject_tenants, one per potential mobile seat
  for (let i = 0; i < SUBJECTS.length; i++) {
    await privilegedSql`
      INSERT INTO subject_tenant (id, tenant_id, name, kind)
      VALUES (${SUBJECTS[i]}, ${TENANT}, ${'Claimant ' + String(i + 1)}, 'claimant')
    `;
  }

  await privilegedSql`
    INSERT INTO subscription (id, tenant_id, stripe_subscription_id, status)
    VALUES (${SUBSCRIPTION}, ${TENANT}, 'sub_test_p91910', 'active')
  `;

  await privilegedSql`
    INSERT INTO subscription_item (id, tenant_id, subscription_id, stripe_subscription_item_id, price_kind)
    VALUES (${SUB_ITEM}, ${TENANT}, ${SUBSCRIPTION}, ${STRIPE_SI_ID}, 'mobile')
  `;
});

after(async () => {
  await cleanup();
  await sql.end();
  await privilegedSql.end();
});

// ---------------------------------------------------------------------------
// Unit tests — computePaidQuantity (pure, no DB)
// ---------------------------------------------------------------------------

const BULK_DISCOUNT_CASES: [number, number][] = [
  [1, 1],
  [2, 2],
  [3, 2],
  [4, 3],
  [5, 4],
  [6, 4],
  [7, 5],
  [8, 6],
  [9, 6],
];

test('computePaidQuantity: 0 subs → 0 (no charge)', () => {
  assert.equal(computePaidQuantity(0), 0);
});

for (const [n, expected] of BULK_DISCOUNT_CASES) {
  test(`computePaidQuantity: ${n} sub(s) → paid_quantity=${expected}`, () => {
    assert.equal(computePaidQuantity(n), expected);
  });
}

// ---------------------------------------------------------------------------
// Integration tests — syncMobileQuantity
// ---------------------------------------------------------------------------

test('syncMobileQuantity: 0 active subs → quantity=0, Stripe called once', async () => {
  // Precondition: no claimant_mobile_subscription rows for TENANT
  const { stripe, calls } = makeMockStripe();

  const paid = await syncMobileQuantity({ tenant_id: TENANT }, stripe);

  assert.equal(paid, 0, 'paid_quantity should be 0');
  assert.equal(calls.length, 1, 'Stripe.subscriptionItems.update called once');
  assert.equal(calls[0]?.subscriptionItemId, STRIPE_SI_ID);
  assert.equal(calls[0]?.params.quantity, 0);
});

test('syncMobileQuantity: 3 active subs → paid_quantity=2 (every 3rd free)', async () => {
  // Insert 3 active subscriptions
  for (let i = 0; i < 3; i++) {
    await privilegedSql`
      INSERT INTO claimant_mobile_subscription (id, tenant_id, subject_tenant_id)
      VALUES (gen_random_uuid(), ${TENANT}, ${SUBJECTS[i]})
    `;
  }

  const { stripe, calls } = makeMockStripe();
  const paid = await syncMobileQuantity({ tenant_id: TENANT }, stripe);

  assert.equal(paid, 2);
  assert.equal(calls[0]?.params.quantity, 2);

  // Soft-delete 1 to test the count correctly for next test
  await privilegedSql`
    UPDATE claimant_mobile_subscription
       SET ended_at = NOW()
     WHERE id = (
       SELECT id FROM claimant_mobile_subscription
        WHERE tenant_id = ${TENANT}
          AND ended_at IS NULL
        LIMIT 1
     )
  `;
});

test('syncMobileQuantity: ended_at rows excluded from count', async () => {
  // After the previous test: 3 rows, 1 ended → 2 active
  const { stripe, calls } = makeMockStripe();
  const paid = await syncMobileQuantity({ tenant_id: TENANT }, stripe);

  assert.equal(paid, 2, '2 active subs = paid_quantity 2');
  assert.equal(calls[0]?.params.quantity, 2);

  // Clean slate for remaining tests
  await privilegedSql`DELETE FROM claimant_mobile_subscription WHERE tenant_id = ${TENANT}`;
});

test('syncMobileQuantity: throws when no mobile subscription_item for tenant', async () => {
  const { stripe } = makeMockStripe();

  await assert.rejects(
    () => syncMobileQuantity({ tenant_id: NO_SI_TENANT }, stripe),
    /no mobile subscription_item/,
    'should throw descriptive error when subscription_item is missing',
  );
});

test('syncMobileQuantity: Stripe failure propagates (pg-boss retries)', async () => {
  const failStripe = {
    subscriptionItems: {
      update: () => Promise.reject(new Error('Stripe network error')),
    },
  } as unknown as Stripe;

  await assert.rejects(
    () => syncMobileQuantity({ tenant_id: TENANT }, failStripe),
    /Stripe network error/,
    'Stripe errors should propagate so pg-boss can retry',
  );
});
