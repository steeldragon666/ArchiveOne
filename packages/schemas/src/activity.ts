import { z } from 'zod';
import { Iso8601, Uuid } from './primitives.js';

/**
 * Activity kind discriminator — Core Activity (CA) vs Supporting
 * Activity (SA), per the R&DTI registration model.
 *
 * Mirrors `ACTIVITY_KINDS` in `@cpa/db/schema/activity.ts`. The two
 * lists must agree byte-for-byte; the wire-format SOT is independent
 * of the storage SOT (see CLAIM_STAGES_LITERAL drift note in
 * `claim.ts`).
 */
export const ActivityKind = z.enum(['core', 'supporting']);
export type ActivityKind = z.infer<typeof ActivityKind>;

/**
 * CA-NN / SA-NN code regex. Allows 2- or 3-digit suffixes (CA-99 to
 * CA-999) — large multi-year programs can exceed two digits.
 *
 * Mirrors the F2 hand-authored CHECK constraint regex on
 * `activity.code` (`^(CA|SA)-\d+$` DB-side; we narrow the digit count
 * to 2-3 here as the realistic surface for a single fiscal year).
 */
export const ActivityCodeRegex = /^(CA|SA)-\d{2,3}$/;

/**
 * Public shape of an `activity` row over the API.
 *
 * `code` is auto-generated server-side (per F9 — next CA-NN / SA-NN in
 * the claim's sequence), so callers don't supply it.
 *
 * Narrative fields (hypothesis through actual_outcome) are all nullable
 * because activities pass through stages of completion as the
 * consultant gathers evidence — nothing is required up-front beyond
 * identity (`code`, `kind`, `title`).
 */
export const Activity = z.object({
  id: Uuid,
  tenant_id: Uuid,
  project_id: Uuid,
  claim_id: Uuid,
  code: z.string().regex(ActivityCodeRegex),
  kind: ActivityKind,
  title: z.string().min(1).max(500),
  description: z.string().nullable(),
  hypothesis: z.string().nullable(),
  technical_uncertainty: z.string().nullable(),
  experimentation_log: z.string().nullable(),
  expected_outcome: z.string().nullable(),
  actual_outcome: z.string().nullable(),
  created_at: Iso8601,
  updated_at: Iso8601,
});
export type Activity = z.infer<typeof Activity>;

/**
 * POST /v1/activities body. `code` is NOT in the body — the route
 * handler assigns the next CA-NN / SA-NN sequence number for the
 * (claim_id, kind) pair.
 *
 * Optional narrative fields can be supplied at create time (the
 * mobile-app hypothesis-prompt form populates `hypothesis` and
 * `expected_outcome` immediately) or left for later editing.
 *
 * `tenant_id` is derived from the session, not the body.
 */
export const CreateActivityBody = z.object({
  project_id: Uuid,
  claim_id: Uuid,
  kind: ActivityKind,
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  hypothesis: z.string().optional(),
  technical_uncertainty: z.string().optional(),
  expected_outcome: z.string().optional(),
});
export type CreateActivityBody = z.infer<typeof CreateActivityBody>;

/**
 * PATCH /v1/activities/:id body — partial update of the long-form
 * narrative fields.
 *
 * Identity fields (`code`, `kind`, `project_id`, `claim_id`) are NOT
 * updatable here — moving an activity between projects/claims or
 * changing its kind requires a separate flow (out of scope for P4).
 */
export const UpdateActivityBody = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().nullable().optional(),
    hypothesis: z.string().nullable().optional(),
    technical_uncertainty: z.string().nullable().optional(),
    experimentation_log: z.string().nullable().optional(),
    expected_outcome: z.string().nullable().optional(),
    actual_outcome: z.string().nullable().optional(),
  })
  .strict();
export type UpdateActivityBody = z.infer<typeof UpdateActivityBody>;
