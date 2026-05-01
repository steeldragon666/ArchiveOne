/**
 * Agent A (expenditure classifier) shared constants & types.
 *
 * Anchored on Australian Income Tax Assessment Act 1997, Division 355.
 * The classifier reads each `EXPENDITURE_INGESTED` event and decides whether
 * the cost is eligible R&DTI expenditure under §355-25 (core R&D) or §355-30
 * (supporting activities), or whether it is ineligible (ordinary-business
 * exclusion, excluded categories), or whether the case is ambiguous and
 * requires human review.
 *
 * These constants are reused by:
 *   - `prompts/classify-expenditure@1.0.0.ts` (tool schema enums)
 *   - the factory + impls (Task 3.2)
 *   - the job processor (Task 3.3, server-side threshold downgrades)
 *
 * The values MUST stay in lock-step with `ExpenditureClassifiedPayload` in
 * `@cpa/schemas/event.ts`. If you bump or rename an enum here, bump the
 * payload `_v` over there and update both call sites.
 */

export const EXPENDITURE_DECISIONS = ['eligible', 'ineligible', 'needs_review'] as const;
export type ExpenditureDecision = (typeof EXPENDITURE_DECISIONS)[number];

export const EXPENDITURE_STATUTORY_ANCHORS = ['s.355-25', 's.355-30', 'ineligible'] as const;
export type ExpenditureStatutoryAnchor = (typeof EXPENDITURE_STATUTORY_ANCHORS)[number];
