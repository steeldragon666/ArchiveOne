import type Stripe from 'stripe';
import { privilegedSql } from '@cpa/db/client';

/**
 * Bulk-discount formula for mobile seat billing — P9.1.10.
 *
 * Every 3rd subscriber is free: `paid_quantity = N - floor(N / 3)`.
 *
 * Examples:
 *   N=1 → 1, N=2 → 2, N=3 → 2, N=4 → 3, N=5 → 4,
 *   N=6 → 4, N=7 → 5, N=8 → 6, N=9 → 6
 *
 * Pure function — no I/O, safe to unit-test in isolation.
 */
export function computePaidQuantity(n: number): number {
  return n - Math.floor(n / 3);
}

/**
 * Recomputes the mobile seat quantity for a tenant and syncs to Stripe.
 *
 * Concurrency: acquires `pg_advisory_xact_lock` on the tenant before
 * counting, serializing concurrent subscribe/unsubscribe calls so no
 * two transactions can double-count active seats.
 *
 * Fault contract: Stripe errors propagate up. The DB count is read inside
 * the transaction but the Stripe call is made AFTER the lock is held. If
 * Stripe fails, the caller (route handler or pg-boss worker) should retry.
 *
 * Privilege: uses `privilegedSql` (bypasses RLS) because the count must be
 * accurate across all claimant_mobile_subscription rows regardless of GUC
 * state, and because pg_advisory_xact_lock semantics require a single
 * connection to own the lock for the transaction lifetime.
 *
 * @returns the new `paid_quantity` posted to Stripe.
 */
export async function syncMobileQuantity(
  { tenant_id }: { tenant_id: string },
  stripe: Stripe,
): Promise<number> {
  return await privilegedSql.begin(async (tx) => {
    // Serialize concurrent recomputes for this tenant.
    // hashtext returns int4; cast to bigint for pg_advisory_xact_lock.
    // The string prefix 'mobile_quantity_' scopes the lock to this feature
    // so it doesn't collide with other advisory locks in the codebase.
    await tx`
      SELECT pg_advisory_xact_lock(hashtext(${'mobile_quantity_' + tenant_id})::bigint)
    `;

    // Count active seats (ended_at IS NULL = still subscribed).
    const countRows = await tx<[{ count: string }]>`
      SELECT COUNT(*) AS count
        FROM claimant_mobile_subscription
       WHERE tenant_id = ${tenant_id}
         AND ended_at IS NULL
    `;
    const n = Number(countRows[0]?.count ?? 0);
    const paid_quantity = computePaidQuantity(n);

    // Resolve the mobile subscription_item for this tenant.
    const siRows = await tx<{ stripe_subscription_item_id: string }[]>`
      SELECT si.stripe_subscription_item_id
        FROM subscription_item si
        JOIN subscription s ON s.id = si.subscription_id
       WHERE s.tenant_id = ${tenant_id}
         AND si.price_kind = 'mobile'
       ORDER BY si.created_at DESC
       LIMIT 1
    `;
    const si = siRows[0];
    if (!si) {
      throw new Error(`syncMobileQuantity: no mobile subscription_item for tenant ${tenant_id}`);
    }

    // Update Stripe quantity (throws on failure — caller retries).
    await stripe.subscriptionItems.update(si.stripe_subscription_item_id, {
      quantity: paid_quantity,
    });

    return paid_quantity;
  });
}
