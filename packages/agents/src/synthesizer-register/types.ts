/**
 * Synthesizer-domain constants for the Agent B activity-register
 * synthesizer.
 *
 * Anchored on Australian Income Tax Assessment Act 1997, Division 355.
 * Every proposed activity is part of the R&D claim — there is no
 * `'ineligible'` option here (that lives on individual EXPENDITURE
 * classifications, not on activity-level groupings). The two
 * classifications are paired with their statutory anchors:
 *
 *   - `core`        ↔ s.355-25  (systematic experimentation)
 *   - `supporting`  ↔ s.355-30  (predominantly supports core R&D,
 *                                dominant-purpose test)
 */
export const ACTIVITY_KINDS = ['core', 'supporting'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_STATUTORY_ANCHORS = ['s.355-25', 's.355-30'] as const;
export type ActivityStatutoryAnchor = (typeof ACTIVITY_STATUTORY_ANCHORS)[number];

/** Hard cap on proposed activities per draft pass. Surfaces in the tool schema. */
export const MAX_PROPOSED_ACTIVITIES = 30;
