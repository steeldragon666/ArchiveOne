import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { privilegedSql, sql } from '@cpa/db/client';
import { emitClaimUsageRecord } from './emit-claim-usage-record.js';

/**
 * Per-claim usage record emitter — P9.1.9.
 *
 * Test namespace: 000000099xxx
 * Fixtures:
 *   TENANT         = ...099001
 *   SUBJECT        = ...099011  (subject_tenant, type claimant)
 *   SUBSCRIPTION   = ...099021
 *   SUB_ITEM       = ...099031  (price_kind = 'per_claim')
 *   CLAIM_A        = ...099041  (unclaimed — platform_fee_charged_at IS NULL)
 *   CLAIM_B        = ...099042  (pre-stamped — platform_fee_charged_at IS NOT NULL)
 */

const TENANT = '00000000-0000-4000-8000-000000099001';
const SUBJECT = '00000000-0000-4000-8000-000000099011';
const SUBSCRIPTION = '00000000-0000-4000-8000-000000099021';
const SUB_ITEM = '00000000-0000-4000-8000-000000099031';
const CLAIM_A = '00000000-0000-4000-8000-000000099041'; // unclaimed
const CLAIM_B = '00000000-0000-4000-8000-000000099042'; // pre-stamped

const STRIPE_SI_ID = 'si_test_p9191_perclaim';

// ---------------------------------------------------------------------------
// Stripe mock helpers
// ---------------------------------------------------------------------------

interface MockCall {
  subscriptionItemId: string;
  params: Stripe.SubscriptionItemCreateUsageRecordParams;
}

function makeMockStripe(onCall?: (call: MockCall) => void): {
  stripe: Stripe;
  calls: MockCall[];
} {
  const calls: MockCall[] = [];
  const stripe = {
    subscriptionItems: {
      createUsageRecord: (
        subscriptionItemId: string,
        params: Stripe.SubscriptionItemCreateUsageRecordParams,
      ) => {
        const call: MockCall = { subscriptionItemId, params };
        calls.push(call);
        if (onCall) onCall(call);
        return Promise.resolve({ id: 'mbur_test_p9191', object: 'usage_record' });
      },
    },
  } as unknown as Stripe;
  return { stripe, calls };
}

// ---------------------------------------------------------------------------
// DB setup / teardown
// ---------------------------------------------------------------------------

const cleanup = async (): Promise<void> => {
  await privilegedSql`DELETE FROM claim WHERE id IN (${CLAIM_A}, ${CLAIM_B})`;
  await privilegedSql`DELETE FROM audit_score_snapshot WHERE subject_tenant_id = ${SUBJECT}`;
  await privilegedSql`DELETE FROM subscription_item WHERE id = ${SUB_ITEM}`;
  await privilegedSql`DELETE FROM subscription WHERE id = ${SUBSCRIPTION}`;
  await privilegedSql`DELETE FROM subject_tenant WHERE id = ${SUBJECT}`;
  await sql`DELETE FROM tenant WHERE id = ${TENANT}`;
};

before(async () => {
  await cleanup();

  await sql`
    INSERT INTO tenant (id, name, slug, primary_idp, billing_mode, trial_status)
    VALUES (${TENANT}, 'Usage Record Firm', 'usage-record-firm-p9191', 'mixed', 'paid', 'converted')
  `;

  await privilegedSql`
    INSERT INTO subject_tenant (id, tenant_id, name, kind)
    VALUES (${SUBJECT}, ${TENANT}, 'Usage Record Co', 'claimant')
  `;

  await privilegedSql`
    INSERT INTO subscription (id, tenant_id, stripe_subscription_id, status)
    VALUES (${SUBSCRIPTION}, ${TENANT}, 'sub_test_p9191', 'active')
  `;

  await privilegedSql`
    INSERT INTO subscription_item (id, tenant_id, subscription_id, stripe_subscription_item_id, price_kind)
    VALUES (${SUB_ITEM}, ${TENANT}, ${SUBSCRIPTION}, ${STRIPE_SI_ID}, 'per_claim')
  `;

  // CLAIM_A: not yet billed (platform_fee_charged_at IS NULL)
  await privilegedSql`
    INSERT INTO claim (id, tenant_id, subject_tenant_id, fiscal_year, stage)
    VALUES (${CLAIM_A}, ${TENANT}, ${SUBJECT}, 2025, 'engagement')
  `;

  // CLAIM_B: already billed (platform_fee_charged_at IS NOT NULL)
  await privilegedSql`
    INSERT INTO claim (id, tenant_id, subject_tenant_id, fiscal_year, stage, platform_fee_charged_at)
    VALUES (${CLAIM_B}, ${TENANT}, ${SUBJECT}, 2024, 'engagement', NOW())
  `;
});

after(async () => {
  await cleanup();
  await sql.end();
  await privilegedSql.end();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('emit-claim-usage-record: posts usage record and stamps claim', async () => {
  const { stripe, calls } = makeMockStripe();

  await emitClaimUsageRecord({ claim_id: CLAIM_A, tenant_id: TENANT }, stripe);

  // Stripe was called once with the correct subscription item ID
  assert.equal(calls.length, 1, 'Stripe should be called exactly once');
  assert.equal(calls[0]?.subscriptionItemId, STRIPE_SI_ID);
  assert.deepEqual(calls[0]?.params, { quantity: 1, action: 'increment' });

  // Claim is now stamped
  const rows = await privilegedSql<{ platform_fee_charged_at: Date | null }[]>`
    SELECT platform_fee_charged_at FROM claim WHERE id = ${CLAIM_A}
  `;
  assert.ok(rows[0]?.platform_fee_charged_at !== null, 'platform_fee_charged_at should be set');
});

test('emit-claim-usage-record: idempotent — skips Stripe when already stamped', async () => {
  const { stripe, calls } = makeMockStripe();

  await emitClaimUsageRecord({ claim_id: CLAIM_B, tenant_id: TENANT }, stripe);

  assert.equal(calls.length, 0, 'Stripe should NOT be called for an already-billed claim');
});

test('emit-claim-usage-record: re-trigger on already-stamped claim_a is also idempotent', async () => {
  // CLAIM_A was stamped by the first test — calling again should skip Stripe
  const { stripe, calls } = makeMockStripe();

  await emitClaimUsageRecord({ claim_id: CLAIM_A, tenant_id: TENANT }, stripe);

  assert.equal(calls.length, 0, 'second call on CLAIM_A should be a no-op');
});

test('emit-claim-usage-record: throws when Stripe fails (pg-boss retries)', async () => {
  // Reset CLAIM_A idempotency stamp so the Stripe call is reached
  await privilegedSql`
    UPDATE claim SET platform_fee_charged_at = NULL WHERE id = ${CLAIM_A}
  `;

  const stripe = {
    subscriptionItems: {
      createUsageRecord: () => {
        return Promise.reject(new Error('Stripe network error'));
      },
    },
  } as unknown as Stripe;

  await assert.rejects(
    () => emitClaimUsageRecord({ claim_id: CLAIM_A, tenant_id: TENANT }, stripe),
    /Stripe network error/,
    'should rethrow Stripe errors so pg-boss can retry',
  );
});
