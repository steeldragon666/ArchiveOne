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

/**
 * Input bundle for {@link ExpenditureClassifier.classify}.
 *
 * Mirrors the JSON the prompt's INPUT BUNDLE description teaches the model to
 * parse. Numeric Postgres columns are serialised as strings (no precision
 * loss), and timestamps as ISO 8601. Optional fields are explicitly nullable
 * rather than omitted so the model sees a stable shape.
 */
export type ExpenditureClassifierInput = {
  expenditure_id: string; // UUID
  expenditure: {
    vendor_name: string;
    description: string | null;
    total_amount: string; // numeric serialised from Postgres
    currency: string;
    expenditure_date: string; // ISO date (YYYY-MM-DD)
    source: 'xero_invoice' | 'xero_bank_tx' | 'xero_receipt' | 'manual';
    kind: 'INVOICE' | 'BANK_TX' | 'RECEIPT';
  };
  project: {
    name: string;
    industry_sector: string | null;
    fiscal_year: number;
  };
  existing_activities: Array<{
    id: string; // UUID
    name: string;
    kind: 'core' | 'supporting';
    statutory_anchor: 's.355-25' | 's.355-30';
    description?: string | null;
  }>;
  recent_evidence_events: Array<{
    id: string; // UUID
    kind: string;
    captured_at: string; // ISO timestamp
    summary: string;
  }>;
};

/**
 * Output of {@link ExpenditureClassifier.classify}.
 *
 * The first six fields are the model's structured tool-use payload (see
 * `prompts/classify-expenditure@1.0.0.ts`). The last four are stamped by the
 * impl/runtime — the model never sees or sets them, so they cannot be
 * fabricated. Token counts are 0 for stub/deterministic impls.
 */
export type ExpenditureClassifierOutput = {
  expenditure_id: string;
  decision: ExpenditureDecision;
  eligibility_probability: number;
  statutory_anchor: ExpenditureStatutoryAnchor;
  suggested_activity_id: string | null;
  rationale: string;
  uncertainty_reason: string | null;
  // Runtime-stamped metadata — NOT model-supplied:
  model: string; // e.g. 'claude-haiku-4-5' or 'stub-v1.0.0'
  prompt_version: string; // e.g. 'classify-expenditure@1.0.0' or 'stub-v1.0.0'
  tokens_in: number;
  tokens_out: number;
};

export interface ExpenditureClassifier {
  classify(input: ExpenditureClassifierInput): Promise<ExpenditureClassifierOutput>;
}
