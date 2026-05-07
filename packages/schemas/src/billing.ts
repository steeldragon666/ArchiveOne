import { z } from 'zod';

/**
 * Tenant pricing tier (P9.1).
 *
 * - standard: default tier, full pricing
 * - founding_partner: first 10 tenants — 50% discount for 12 months
 *
 * KEEP IN SYNC WITH:
 *   1. `tenant.tier` CHECK constraint in migration 0041
 *   2. `founding_partner_slots` table (claiming a slot upgrades to this tier)
 */
export const PlanTierEnum = z.enum(['standard', 'founding_partner']);
export type PlanTier = z.infer<typeof PlanTierEnum>;

/**
 * Stripe subscription lifecycle status (P9.1).
 *
 * Mirrors the Stripe subscription status values surfaced via webhook events.
 *
 * - trialing: in the 14-day free trial period
 * - active: subscription current and paid
 * - past_due: payment failed; dunning in progress
 * - cancelled: subscription ended
 * - incomplete: Checkout started but payment not yet confirmed
 *
 * KEEP IN SYNC WITH:
 *   1. `subscription.status` CHECK constraint in migration 0041
 */
export const SubscriptionStatusEnum = z.enum([
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'incomplete',
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusEnum>;

/**
 * Claim delivery kind (P9.1).
 *
 * Determines which Stripe price is billed for a completed delivery:
 * - quarterly_assurance: $1,500 AUD per delivery
 * - annual_claim: $1,500 AUD per delivery (same rate, distinct label for reporting)
 *
 * Nullable on `claim` — null means no delivery has been billed yet.
 *
 * KEEP IN SYNC WITH:
 *   1. `claim.delivery_kind` CHECK constraint in migration 0041
 */
export const DeliveryKindEnum = z.enum(['quarterly_assurance', 'annual_claim']);
export type DeliveryKind = z.infer<typeof DeliveryKindEnum>;

/**
 * Tenant billing lifecycle mode (P9.1).
 *
 * Governs which billing rules apply to the tenant overall:
 * - trial: 14-day free trial; no charges yet
 * - paid: active subscription; metered billing in effect
 * - archived: tenant offboarded; read-only access
 *
 * KEEP IN SYNC WITH:
 *   1. `tenant.billing_mode` CHECK constraint in migration 0041
 */
export const BillingModeEnum = z.enum(['trial', 'paid', 'archived']);
export type BillingMode = z.infer<typeof BillingModeEnum>;

/**
 * Trial lifecycle status (P9.1).
 *
 * Tracks where the tenant is within (or past) the free trial:
 * - active: trial running; trial_ends_at in the future
 * - expired: trial ended without conversion
 * - converted: tenant completed checkout; now on paid subscription
 *
 * KEEP IN SYNC WITH:
 *   1. `tenant.trial_status` CHECK constraint in migration 0041
 */
export const TrialStatusEnum = z.enum(['active', 'expired', 'converted']);
export type TrialStatus = z.infer<typeof TrialStatusEnum>;
