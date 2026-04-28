/**
 * Classifier-domain evidence kinds for the R&D Tax Incentive (R&DTI)
 * classifier.
 *
 * Anchored on Australian Income Tax Assessment Act 1997, Division 355.
 * Scope: the 12 R&D evidence categories the classifier may output
 * ({@link CLASSIFIABLE_KINDS}) plus `OVERRIDE` (the synthetic kind a
 * human reviewer emits to supersede a prior classification — the model
 * itself never produces it).
 *
 * NOT the full kind universe — the DB column `event.kind` is wider.
 * P4 added 14 state-transition kinds (ACTIVITY_CREATED, CLAIM_SUBMITTED,
 * PROJECT_CREATED, etc.) that the classifier does not produce and does
 * not validate against; those live in `EVIDENCE_KINDS` in
 * `@cpa/db/schema/event.ts` and `evidenceKind` in `@cpa/schemas/event.ts`.
 * Do not extend this list with state-transition kinds — that would
 * widen the classifier's output domain to kinds it has no statutory
 * basis to emit.
 */
export const EVIDENCE_KINDS = [
  'HYPOTHESIS',
  'DESIGN',
  'EXPERIMENT',
  'OBSERVATION',
  'ITERATION',
  'NEW_KNOWLEDGE',
  'UNCERTAINTY',
  'TIME_LOG',
  'ASSOCIATE_FLAG',
  'EXPENDITURE_NOTE',
  'SUPPORTING',
  'INELIGIBLE',
  'OVERRIDE',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * Subset of {@link EVIDENCE_KINDS} that the classifier can output. `OVERRIDE`
 * is excluded because it represents a human reviewer decision, not a model
 * classification.
 */
export const CLASSIFIABLE_KINDS = [
  'HYPOTHESIS',
  'DESIGN',
  'EXPERIMENT',
  'OBSERVATION',
  'ITERATION',
  'NEW_KNOWLEDGE',
  'UNCERTAINTY',
  'TIME_LOG',
  'ASSOCIATE_FLAG',
  'EXPENDITURE_NOTE',
  'SUPPORTING',
  'INELIGIBLE',
] as const;
export type ClassifiableKind = (typeof CLASSIFIABLE_KINDS)[number];

export type ClassifierInput = { raw_text: string };

export type ClassifierOutput = {
  kind: ClassifiableKind;
  confidence: number;
  rationale: string;
  statutory_anchor: string | null;
  model: string;
  prompt_version: string;
  tokens_in: number;
  tokens_out: number;
};

export interface Classifier {
  classify(input: ClassifierInput): Promise<ClassifierOutput>;
}
