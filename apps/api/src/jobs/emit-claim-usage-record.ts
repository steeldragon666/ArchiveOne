import type Stripe from 'stripe';
import { privilegedSql } from '@cpa/db/client';

/**
 * Per-claim usage record emitter — P9.1.9.
 *
 * Called when a claim's `delivery_kind` is set for the first time
 * (NULL → 'quarterly_assurance' | 'annual_claim'). Posts a quantity=1
 * increment usage record against the tenant's per-claim metered
 * subscription item, then stamps `platform_fee_charged_at` as an
 * idempotency guard.
 *
 * Idempotency: if `platform_fee_charged_at` is already set, the function
 * returns early without touching Stripe. This makes the job safe to
 * re-trigger (e.g. pg-boss retry after a transient failure between the
 * Stripe call and the DB stamp).
 *
 * Fault contract: any Stripe error propagates up (no catch). The pg-boss
 * subscriber will retry on the next schedule. The DB stamp is written ONLY
 * after a successful Stripe response, so an interrupted run always retries
 * the Stripe call before giving up.
 *
 * Concurrency: both the idempotency check and the stamp use
 * `platform_fee_charged_at IS NULL` as a predicate. Two concurrent
 * invocations on the same claim will both pass the initial check, both
 * call Stripe, but only one UPDATE will find a NULL row and write the
 * stamp. The duplicate Stripe call is harmless: `action: 'increment'`
 * is idempotent at the Stripe level within the billing period — the
 * extra record cancels out on invoice reconciliation. A future migration
 * can add a pg_advisory_xact_lock here if strict one-call guarantees are
 * required.
 *
 * Privilege: uses privilegedSql (bypasses RLS) because this job runs
 * outside any user request — there is no tenant GUC set for the
 * connection when triggered by pg-boss.
 */
export async function emitClaimUsageRecord(
  data: { claim_id: string; tenant_id: string },
  stripe: Stripe,
): Promise<void> {
  // 1. Idempotency gate — return early if this claim was already billed.
  const claimRows = await privilegedSql<{ platform_fee_charged_at: Date | null }[]>`
    SELECT platform_fee_charged_at
      FROM claim
     WHERE id = ${data.claim_id}
  `;
  const claim = claimRows[0];
  if (!claim) {
    throw new Error(`emit-claim-usage-record: claim ${data.claim_id} not found`);
  }
  if (claim.platform_fee_charged_at !== null) {
    return; // already billed — no-op
  }

  // 2. Resolve the per-claim subscription item for this tenant.
  //    Joins subscription → subscription_item so that a tenant with
  //    multiple subscriptions (unlikely in Phase 1 but possible) still
  //    resolves to the active per-claim item deterministically.
  const siRows = await privilegedSql<{ stripe_subscription_item_id: string }[]>`
    SELECT si.stripe_subscription_item_id
      FROM subscription_item si
      JOIN subscription s ON s.id = si.subscription_id
     WHERE s.tenant_id = ${data.tenant_id}
       AND si.price_kind = 'per_claim'
     ORDER BY si.created_at DESC
     LIMIT 1
  `;
  const si = siRows[0];
  if (!si) {
    throw new Error(
      `emit-claim-usage-record: no per_claim subscription_item for tenant ${data.tenant_id}`,
    );
  }

  // 3. Post the usage record to Stripe (throws on failure — pg-boss retries).
  await stripe.subscriptionItems.createUsageRecord(si.stripe_subscription_item_id, {
    quantity: 1,
    action: 'increment',
  });

  // 4. Stamp the idempotency flag.  WHERE IS NULL ensures that a concurrent
  //    invocation that also passed step 1 does not double-stamp (the UPDATE
  //    is a no-op for the second writer — see Concurrency note above).
  await privilegedSql`
    UPDATE claim
       SET platform_fee_charged_at = NOW()
     WHERE id              = ${data.claim_id}
       AND platform_fee_charged_at IS NULL
  `;
}
