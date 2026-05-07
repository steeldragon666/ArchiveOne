import { privilegedSql } from '@cpa/db/client';

/**
 * Founding-partner slot allocator — P9.1.8.
 *
 * The `founding_partner_slots` table is seeded with 10 rows (migration 0041).
 * The first 10 firms to convert get a 50%-off-for-12-months coupon applied
 * to their Stripe Checkout session.
 *
 * Concurrency safety: the UPDATE subquery uses `FOR UPDATE SKIP LOCKED` so that
 * two simultaneous checkout requests racing to claim the last slot can never
 * both succeed — one transaction will skip the locked row and find no eligible
 * row to update, returning 0 rows.
 *
 * No `pg_advisory_xact_lock` needed: SKIP LOCKED provides per-row serialisation
 * without a global choke point.
 */

/** Stripe coupon ID created during ops setup (Task 1.1). */
export const FOUNDER_COUPON_ID = 'FOUNDER-50';

/**
 * Atomically claim a founding-partner slot for the given tenant.
 *
 * @returns `true` if a slot was claimed (caller should apply FOUNDER_COUPON_ID),
 *          `false` if all 10 slots are already taken.
 */
export async function tryClaimFoundingPartnerSlot(tenantId: string): Promise<boolean> {
  const rows = await privilegedSql<{ id: string }[]>`
    UPDATE founding_partner_slots
       SET claimed_by_tenant_id = ${tenantId},
           claimed_at           = NOW()
     WHERE id = (
           SELECT id
             FROM founding_partner_slots
            WHERE claimed_by_tenant_id IS NULL
            LIMIT 1
            FOR UPDATE SKIP LOCKED
           )
 RETURNING id
  `;
  return rows.length > 0;
}
