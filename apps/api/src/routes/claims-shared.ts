import type Stripe from 'stripe';
import type { Claim, ClaimStage } from '@cpa/schemas';

/**
 * Shared types + projection helpers for the claims route family.
 *
 * Extracted from the original monolithic claims.ts so the four sibling
 * route files (claims-crud / -delivery / -allocations / -finalisation)
 * share one canonical row shape + toApi mapper. Behaviour is unchanged
 * from the pre-split monolith.
 */

export interface ClaimsRouteDeps {
  /**
   * Stripe client — used by the per-claim usage-record emitter that
   * fires when a consultant sets delivery_kind. Optional because tests
   * and dev environments without billing configured can omit it.
   */
  stripe?: Stripe;
}

/**
 * Raw claim row as stored in postgres. Columns are snake_case to match
 * the SQL surface; conversion to the wire format (still snake_case but
 * with ISO-8601 timestamps in place of Date objects) happens in
 * {@link toApi}.
 */
export interface RawClaimRow {
  id: string;
  tenant_id: string;
  subject_tenant_id: string;
  fiscal_year: number;
  stage: ClaimStage;
  delivery_kind: string | null;
  platform_fee_charged_at: Date | string | null;
  ausindustry_reference: string | null;
  submitted_at: Date | string | null;
  submitted_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  is_wizard_claim: boolean;
}

export const isoOf = (v: Date | string): string => (typeof v === 'string' ? v : v.toISOString());

export const isoOrNull = (v: Date | string | null): string | null => (v === null ? null : isoOf(v));

export const toApi = (r: RawClaimRow): Claim => ({
  id: r.id,
  tenant_id: r.tenant_id,
  subject_tenant_id: r.subject_tenant_id,
  fiscal_year: r.fiscal_year,
  stage: r.stage,
  delivery_kind: (r.delivery_kind as Claim['delivery_kind']) ?? null,
  ausindustry_reference: r.ausindustry_reference,
  submitted_at: isoOrNull(r.submitted_at),
  submitted_by_user_id: r.submitted_by_user_id,
  created_at: isoOf(r.created_at),
  updated_at: isoOf(r.updated_at),
  is_wizard_claim: r.is_wizard_claim,
});
