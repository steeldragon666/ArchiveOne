import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared field-length constraints
// ---------------------------------------------------------------------------

/** AusIndustry portal field character limit for narrative text blocks. */
const Char4000 = z.string().max(4000);

/** AusIndustry portal field character limit for activity name. */
const Char200 = z.string().max(200);

// ---------------------------------------------------------------------------
// Enums — mirror the AusIndustry registration form checkbox sets
// ---------------------------------------------------------------------------

/**
 * "How did you determine the outcome could not be known or determined
 *  in advance?" — multi-select on the AusIndustry portal.
 */
export const OutcomeUnknownMethodEnum = z.enum([
  'no_applicable_literature',
  'expert_advice',
  'no_adaptable_solutions',
  'other',
  'did_not_investigate',
]);
export type OutcomeUnknownMethod = z.infer<typeof OutcomeUnknownMethodEnum>;

/**
 * "What types of evidence have been kept for this activity?" —
 * multi-select on the AusIndustry portal.
 */
export const EvidenceKeptCategoryEnum = z.enum([
  'hypothesis_design',
  'results_evaluation',
  'experiment_revisions',
  'knowledge_searches',
  'systematic_progression',
  'other',
  'no_records_kept',
]);
export type EvidenceKeptCategory = z.infer<typeof EvidenceKeptCategoryEnum>;

// ---------------------------------------------------------------------------
// Core Activity — 13 fields
// ---------------------------------------------------------------------------

/**
 * Per-field content for a Core Activity registration on the AusIndustry
 * portal. Maps 1:1 to the registration form's 13-field structure for
 * core R&D activities under Section 355-25 ITAA 1997.
 */
export const CorePortalFieldsSchema = z.object({
  activity_name: Char200,
  description: Char4000,
  outcome_unknown_methods: z.array(OutcomeUnknownMethodEnum).min(1),
  sources_investigated: Char4000,
  why_competent_professional_couldnt_know: Char4000,
  hypothesis: Char4000,
  experiment: Char4000,
  evaluation: Char4000,
  conclusions: Char4000,
  evidence_kept_categories: z.array(EvidenceKeptCategoryEnum).min(1),
  new_knowledge_purpose: Char4000,
  expenditure_estimate_aud: z.number().nonnegative(),
  related_supporting_activity_ids: z.array(z.string().uuid()),
});
export type CorePortalFields = z.infer<typeof CorePortalFieldsSchema>;

// ---------------------------------------------------------------------------
// Supporting Activity — 9 fields (+ nested sub-fields)
// ---------------------------------------------------------------------------

/**
 * Per-field content for a Supporting Activity registration on the
 * AusIndustry portal. Maps to the form's structure for supporting
 * R&D activities under Section 355-30 ITAA 1997.
 */
export const SupportingPortalFieldsSchema = z.object({
  activity_name: Char200,
  description: Char4000,
  supports_core_activity_ids: z.array(z.string().uuid()).min(1),
  how_supports_core_rd: Char4000,
  who_performed_work: z.enum([
    'r_and_d_company_only',
    'r_and_d_company_and_others',
    'subsidiary_or_group_or_others',
    'others_only',
  ]),
  dates_conducted: z.object({ start: z.string().date(), end: z.string().date() }),
  expenditure_estimate_aud: z.number().nonnegative(),
  produces_good_or_service: z.boolean(),
  dominant_purpose: z.object({
    is_dominant_purpose: z.literal(true),
    explanation: Char4000,
  }),
  evidence_kept: Char4000,
});
export type SupportingPortalFields = z.infer<typeof SupportingPortalFieldsSchema>;

// ---------------------------------------------------------------------------
// Character limits map — for UI character-count display
// ---------------------------------------------------------------------------

/**
 * Character limits for narrative text fields, grouped by activity kind.
 * Used by the web UI to render character-count indicators below each
 * textarea. Matches the `.max()` constraints on the Zod schemas above.
 */
export const PortalFieldCharacterLimits = {
  core: {
    description: 4000,
    sources_investigated: 4000,
    why_competent_professional_couldnt_know: 4000,
    hypothesis: 4000,
    experiment: 4000,
    evaluation: 4000,
    conclusions: 4000,
    new_knowledge_purpose: 4000,
  },
  supporting: {
    description: 4000,
    how_supports_core_rd: 4000,
    dominant_purpose_explanation: 4000,
    evidence_kept: 4000,
  },
} as const;
