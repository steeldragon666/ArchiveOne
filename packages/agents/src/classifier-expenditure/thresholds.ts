/**
 * Auto-apply / review-recommended cutoffs for Agent A's
 * `eligibility_probability`.
 *
 * Phase-1 defaults — calibrated AFTER dogfood telemetry per the P6 design doc
 * (Section 3). Until the eval harness produces a calibration curve these are
 * the conservative starting points:
 *
 *   - `>= AUTO_APPLY` (0.85): the job processor may auto-apply the model's
 *     decision (e.g. raise an `EXPENDITURE_CLASSIFIED` event without
 *     downgrade).
 *   - `>= REVIEW_RECOMMENDED` and `< AUTO_APPLY`: surfaces in the consultant
 *     review queue but the model's decision is preserved.
 *   - `< REVIEW_RECOMMENDED` (0.70): Task 3.3's processor downgrades
 *     `decision='eligible'` to `'needs_review'` so a human resolves the
 *     ambiguity before any claim impact.
 *
 * Source-of-truth lives in TypeScript (not env) so the calibration knob is
 * code-reviewed when it changes.
 */
export const EXPENDITURE_CONFIDENCE_THRESHOLDS = {
  AUTO_APPLY: 0.85,
  REVIEW_RECOMMENDED: 0.7,
} as const;
