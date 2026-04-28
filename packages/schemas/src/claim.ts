import { z } from 'zod';
import { Iso8601, Uuid } from './primitives.js';

/**
 * Single source of truth for claim pipeline stages over the wire.
 *
 * Dual SOT pattern: `@cpa/schemas` (Zod, wire format) and `@cpa/db`
 * (Drizzle, storage) are intentionally independent SOTs — `@cpa/db`
 * depends on `@cpa/schemas` (one-way), so importing `CLAIM_STAGES` from
 * `@cpa/db/schema` here would invert the layering and pull storage
 * internals into the wire contract. The two lists must therefore be
 * kept in sync by hand.
 *
 * KEEP IN SYNC WITH:
 *   1. `CLAIM_STAGES` in `@cpa/db/schema/claim.ts`
 *   2. The `claim_stage_valid` CHECK in `migrations/0012_hard_titania.sql`
 *
 * Order matches `@cpa/db` byte-for-byte.
 */
export const CLAIM_STAGES_LITERAL = [
  'engagement',
  'activity_capture',
  'narrative_drafting',
  'expenditure_schedule',
  'review',
  'submitted',
  'audit_defence',
] as const;
export const ClaimStage = z.enum(CLAIM_STAGES_LITERAL);
export type ClaimStage = z.infer<typeof ClaimStage>;

/**
 * Public shape of a `claim` row over the API.
 *
 * `fiscal_year` follows Australian convention: `2025` = FY ending June
 * 2025 (1 July 2024 – 30 June 2025).
 *
 * `ausindustry_reference` carries the regulator-issued registration ID
 * (only known post-submission, hence nullable). `submitted_at` /
 * `submitted_by_user_id` mark the submission event for audit trail.
 */
export const Claim = z.object({
  id: Uuid,
  tenant_id: Uuid,
  subject_tenant_id: Uuid,
  fiscal_year: z.number().int(),
  stage: ClaimStage,
  ausindustry_reference: z.string().nullable(),
  submitted_at: Iso8601.nullable(),
  submitted_by_user_id: Uuid.nullable(),
  created_at: Iso8601,
  updated_at: Iso8601,
});
export type Claim = z.infer<typeof Claim>;

/**
 * POST /v1/claims body. `stage` defaults to `'engagement'` server-side;
 * callers that want to seed a claim mid-pipeline (e.g. importing a
 * partially-completed prior-year submission) can supply it explicitly.
 *
 * `ausindustry_reference` is generally null at create time — populated
 * post-submission via the regulator integration.
 *
 * `tenant_id` is derived from the session, not the body.
 */
export const CreateClaimBody = z.object({
  subject_tenant_id: Uuid,
  fiscal_year: z.number().int(),
  stage: ClaimStage.optional(),
  ausindustry_reference: z.string().optional(),
});
export type CreateClaimBody = z.infer<typeof CreateClaimBody>;

/**
 * PATCH /v1/claims/:id/stage body. Used to advance the claim through
 * the 7-stage pipeline. The route handler validates the source stage
 * and emits a `CLAIM_STAGE_ADVANCED` event.
 */
export const UpdateClaimStageBody = z.object({
  to_stage: ClaimStage,
});
export type UpdateClaimStageBody = z.infer<typeof UpdateClaimStageBody>;
