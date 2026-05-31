import { z } from 'zod';
import { Iso8601, Uuid } from './primitives.js';

/**
 * Notional R&D adjustment — Subdiv 355-G line items. Migration 0097
 * created the table; this module defines the wire contract.
 *
 * Dual SOT pattern (same as Expenditure) — keep in sync with:
 *   1. `NOTIONAL_ADJUSTMENT_KINDS` in `@cpa/db/schema/notional_adjustment.ts`
 *   2. The CHECK constraint in migration 0097
 *
 * Sign convention is documented in the migration's COMMENT — Zod here
 * does NOT enforce sign-per-kind because the consultant occasionally
 * adjusts the sign manually (e.g. balancing adjustment can be ±).
 */
export const NOTIONAL_ADJUSTMENT_KINDS_LITERAL = [
  'feedstock',
  'recoupment',
  'associate_payment',
  'depreciation',
  'balancing_adjustment',
] as const;
export const NotionalAdjustmentKind = z.enum(NOTIONAL_ADJUSTMENT_KINDS_LITERAL);
export type NotionalAdjustmentKind = z.infer<typeof NotionalAdjustmentKind>;

/** Postgres NUMERIC(14,2) wire-format — same shape as Expenditure.total_amount but wider. */
export const Numeric14_2Regex = /^-?\d{1,12}\.\d{2}$/;

export const NotionalAdjustment = z.object({
  id: Uuid,
  tenant_id: Uuid,
  claim_id: Uuid,
  kind: NotionalAdjustmentKind,
  amount_aud: z.string().regex(Numeric14_2Regex, 'must be -?N.NN (postgres NUMERIC(14,2))'),
  description: z.string().min(1).max(2000),
  statutory_anchor: z.string().min(1).max(200),
  first_recorded_at: Iso8601,
  hypothesis_formed_at: Iso8601.nullable(),
  created_at: Iso8601,
  created_by_user_id: Uuid,
  updated_at: Iso8601,
});
export type NotionalAdjustment = z.infer<typeof NotionalAdjustment>;

/** POST /v1/claims/:claim_id/notional-adjustments body. */
export const CreateNotionalAdjustmentBody = z.object({
  kind: NotionalAdjustmentKind,
  amount_aud: z.string().regex(Numeric14_2Regex),
  description: z.string().min(1).max(2000),
  statutory_anchor: z.string().min(1).max(200),
  hypothesis_formed_at: Iso8601.nullable().optional(),
});
export type CreateNotionalAdjustmentBody = z.infer<typeof CreateNotionalAdjustmentBody>;
