import { NARRATIVE_SECTION_KINDS, type NarrativeSectionKind } from '@cpa/db/schema';

/**
 * P7 Theme A Task A.3 — multi-cycle summarizer shared constants & types.
 *
 * The multi-cycle summarizer reads the prior-FY narrative chain returned by
 * {@link walkProposedIdChain} (Task A.2) and emits a CITATION GRAPH — a
 * structured set of references back to the existing `narrative_segment` rows
 * the chain already contains. The agent does NOT paraphrase prior-year prose;
 * it only classifies how each cited segment fits the multi-cycle continuity
 * narrative (continuation / pivot / completion / abandoned) and points the
 * downstream UI at the verbatim segment text via `(narrative_draft_id,
 * cited_segment_indices, content_hash)` tuples.
 *
 * **Body-by-Michael compliance (architectural intent):** the output schema is
 * structurally incapable of carrying free-text prose. The only string field
 * that an LLM can populate is `transition_rationale`, hard-capped at 500
 * chars and explicitly scoped to "why this transition classification" —
 * never "what did the prior year say". Verbatim narrative is rendered
 * downstream by reading the cited `narrative_segment.text` rows directly,
 * not by an LLM intermediary.
 *
 * Constants used by:
 *   - `prompts/multi-cycle-summarize@1.0.0.ts` (tool schema enums)
 *   - downstream consumers that map the citation graph onto stored
 *     narrative_segment rows
 */

/**
 * Re-export of `NARRATIVE_SECTION_KINDS` from `@cpa/db` so the multi-cycle
 * domain owns a stable name for its citation-graph `section_kind` enum.
 *
 * The values MUST stay in lock-step with `narrative_draft.section_kind` (the
 * `narrative_draft_section_kind_valid` CHECK constraint in
 * `0029_narrative_draft.sql`) — they are denormalised onto each
 * `narrative_segment` row at backfill time. Drift would either cause a
 * Zod parse failure when the runtime walks the chain or, worse, silently
 * mis-classify cited segments.
 */
export const MULTI_CYCLE_SECTION_KINDS = NARRATIVE_SECTION_KINDS;
export type MultiCycleSectionKind = NarrativeSectionKind;

/**
 * Closed enum of transition classifications between successive FYs in a
 * proposed_id chain.
 *
 *   - `continuation` — FY-N+1 continues the FY-N hypothesis substantially
 *      unchanged (same research question, same uncertainty, deeper data).
 *   - `pivot`        — FY-N+1 reformulated the hypothesis (shifted question,
 *      new uncertainty, prior data still cited as context).
 *   - `completion`   — FY-N+1 reached a resolution (the uncertainty was
 *      collapsed; new_knowledge was generated).
 *   - `abandoned`    — FY-N+1 dropped the line of inquiry without resolution
 *      (e.g. budget cut, technical infeasibility, pivot to a sibling
 *      activity tracked under a different proposed_id).
 *
 * The agent picks ONE per cited segment. The matching `transition_rationale`
 * (≤500 chars) explains the choice — NOT the prior-year content.
 */
export const MULTI_CYCLE_TRANSITION_KINDS = [
  'continuation',
  'pivot',
  'completion',
  'abandoned',
] as const;
export type MultiCycleTransitionKind = (typeof MULTI_CYCLE_TRANSITION_KINDS)[number];

/**
 * One row of the prior-FY chain projected into the agent's input bundle.
 *
 * Mirrors {@link ActivityHistoryRow} from `walk-proposed-id.ts` but with
 * timestamps serialised to ISO strings (the chain walker returns Dates from
 * Postgres; the agent boundary serialises to JSON) and with the bundle's
 * per-draft `segments` list pre-projected so the agent never needs to
 * re-fetch the segment table.
 *
 * `segments` carries `(segment_index, type, text, content_hash)` tuples for
 * each segment of the cited draft. The `text` field is the ONLY place
 * verbatim prior-year prose lives in the bundle — the agent reads it to
 * decide which segments to cite, but the OUTPUT schema is structurally
 * incapable of echoing it back (see Body-by-Michael compliance note above).
 */
export type PriorFyDraft = {
  activity_id: string; // UUID
  fy_label: string; // e.g. 'FY24'
  hypothesis_formed_at: string; // ISO 8601 timestamp
  proposed_id: string; // UUID
  narrative_draft_id: string; // UUID
  content_hash: string; // sha256 of canonicalised segments
  section_kind: MultiCycleSectionKind;
  segments: Array<{
    segment_index: number;
    type: 'prose' | 'claim';
    text: string;
    content_hash: string;
  }>;
};

/**
 * Input bundle for one multi-cycle summarisation pass.
 *
 * Assembled by the runtime from {@link walkProposedIdChain} output + a join
 * to `narrative_segment`. The agent receives one bundle covering the entire
 * chain (all FYs sharing this `proposed_id`) and emits a single citation
 * graph spanning that chain.
 *
 * `current_fy_label` is the FY the consultant is currently drafting — the
 * agent's job is to produce continuity citations from prior FYs UP TO (and
 * NOT including) this label. The agent should error if the chain contains
 * a row with `fy_label === current_fy_label` (the runtime caller is
 * responsible for filtering, but defensive validation is cheap).
 */
export type MultiCycleSummarizerInput = {
  proposed_id: string; // UUID — root of the chain
  current_fy_label: string; // e.g. 'FY26'
  prior_fy_drafts: PriorFyDraft[];
};

/**
 * Output shape returned by every {@link MultiCycleSummarizer} implementation.
 *
 * The structural fields (`proposed_id`, `fy_labels`, `citation_graph`,
 * `total_fys_covered`, `earliest_hypothesis_formed_at`) come from the model
 * (or the deterministic stub). The metadata fields (`prompt_version`,
 * `model`, `idempotency_key`) are stamped by the runtime / impl AFTER the
 * model returns — the model never sees or sets them.
 *
 * Crucially, this shape contains NO field whose semantics could carry
 * paraphrased prior-year prose. `transition_rationale` (per citation, ≤500
 * chars) is scoped to "why this transition classification" only.
 */
export type MultiCycleSummarizerOutput = {
  proposed_id: string;
  fy_labels: string[];
  citation_graph: Array<{
    fy_label: string;
    narrative_draft_id: string;
    section_kind: MultiCycleSectionKind;
    content_hash: string;
    cited_segment_indices: number[];
    transition_kind: MultiCycleTransitionKind;
    transition_rationale: string; // ≤ 500 chars
  }>;
  total_fys_covered: number;
  earliest_hypothesis_formed_at: string; // ISO 8601 timestamp
  // Stamped by the impl/runtime, NOT by the model:
  prompt_version: '1.0.0';
  model: string;
  idempotency_key: string;
};

export interface MultiCycleSummarizer {
  summarize(input: MultiCycleSummarizerInput): Promise<MultiCycleSummarizerOutput>;
}
