import { z } from 'zod';

/**
 * Prompt-suggestion shared contracts (issue #28 / P7 C2).
 *
 * Until this module existed, the four enum literal unions and four input
 * Zod schemas lived inline in `apps/api/src/routes/prompt-suggestions.ts`
 * and were re-mirrored in `apps/web/src/app/suggestions/_lib/types.ts`,
 * with `@cpa/db/schema/prompt_suggestion.ts` carrying a third copy of
 * just the enums. Three-way parity was tested via the route's
 * `_internals` export.
 *
 * Promoting to `@cpa/schemas` gives the three layers a single source of
 * truth — drift in either the web app or the API route surfaces at
 * typecheck instead of as 400/500 from the wire.
 *
 * The enum arrays MUST stay in sync with the SQL CHECK constraints in
 * `packages/db/migrations/0038_prompt_suggestion_queue.sql` and with the
 * mirrored `PROMPT_SUGGESTION_*` arrays in
 * `packages/db/src/schema/prompt_suggestion.ts`. The contract test in
 * `apps/api/src/routes/prompt-suggestions.contract.test.ts` enforces the
 * three-way parity (SQL CHECK ↔ db const ↔ this Zod enum).
 */

/** Source taxonomy for a flagged suggestion. */
export const PROMPT_SUGGESTION_SOURCE_KINDS = [
  'consultant_flag',
  'rif_event',
  'contract_test_failure',
  'reviewer_disposition',
] as const;
export type PromptSuggestionSourceKind = (typeof PROMPT_SUGGESTION_SOURCE_KINDS)[number];

/** Lifecycle status. State transitions are validated at the API layer. */
export const PROMPT_SUGGESTION_STATUSES = [
  'open',
  'triaged',
  'pr_drafted',
  'pr_merged',
  'dismissed',
] as const;
export type PromptSuggestionStatus = (typeof PROMPT_SUGGESTION_STATUSES)[number];

/** Reviewer-assigned classification at triage. Nullable until triaged. */
export const PROMPT_SUGGESTION_TRIAGE_CLASSIFICATIONS = [
  'prompt_change',
  'schema_change',
  'code_change',
  'no_action_needed',
] as const;
export type PromptSuggestionTriageClassification =
  (typeof PROMPT_SUGGESTION_TRIAGE_CLASSIFICATIONS)[number];

/** Disposition assigned by a reviewer after a triaged suggestion is reviewed. */
export const PROMPT_SUGGESTION_REVIEW_DISPOSITIONS = [
  'approve_for_pr',
  'request_more_info',
  'dismiss',
  'escalate_to_code_change',
] as const;
export type PromptSuggestionReviewDisposition =
  (typeof PROMPT_SUGGESTION_REVIEW_DISPOSITIONS)[number];

// ---------------------------------------------------------------------------
// Input Zod schemas — one per write endpoint. `.strict()` so unknown fields
// surface as 400 rather than silently ignored (matches the route's prior
// inline-strict shape).
// ---------------------------------------------------------------------------

export const flagSuggestionBody = z
  .object({
    source_kind: z.enum(PROMPT_SUGGESTION_SOURCE_KINDS),
    source_payload: z.record(z.unknown()),
    affected_prompt_module: z.string().min(1).max(200).optional(),
    affected_section_kind: z.string().min(1).max(100).optional(),
    issue_summary: z.string().min(10).max(1000),
  })
  .strict();
export type FlagSuggestionBody = z.infer<typeof flagSuggestionBody>;

export const listSuggestionsQuery = z
  .object({
    status: z.enum(PROMPT_SUGGESTION_STATUSES).optional(),
    source_kind: z.enum(PROMPT_SUGGESTION_SOURCE_KINDS).optional(),
    limit: z.coerce.number().int().positive().max(100).default(50),
    cursor: z.string().optional(),
  })
  .strict();
export type ListSuggestionsQuery = z.infer<typeof listSuggestionsQuery>;

export const triageSuggestionBody = z
  .object({
    triage_classification: z.enum(PROMPT_SUGGESTION_TRIAGE_CLASSIFICATIONS),
    // Only two valid post-triage statuses; other transitions go through
    // review / generate-pr.
    status_after: z.enum(['triaged', 'dismissed']),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export type TriageSuggestionBody = z.infer<typeof triageSuggestionBody>;

export const reviewSuggestionBody = z
  .object({
    disposition: z.enum(PROMPT_SUGGESTION_REVIEW_DISPOSITIONS),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export type ReviewSuggestionBody = z.infer<typeof reviewSuggestionBody>;
