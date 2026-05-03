import { z } from 'zod';
import { Sha256Hash } from '@cpa/schemas';
import { registerPrompt } from '../../runtime/prompt-registry.js';
import { MULTI_CYCLE_SECTION_KINDS, MULTI_CYCLE_TRANSITION_KINDS } from '../types.js';

/**
 * P7 Theme A Task A.3 — `multi-cycle-summarize@1.0.0` prompt module.
 *
 * Anchored on the "Body by Michael" architectural intent: the multi-cycle
 * summariser's output is a CITATION GRAPH, not a summary. The agent's job
 * is to point downstream consumers at existing `narrative_segment` rows
 * (via `(narrative_draft_id, cited_segment_indices, content_hash)` tuples)
 * AND to classify the FY-to-FY transitions (continuation / pivot /
 * completion / abandoned) — never to paraphrase prior-year prose.
 *
 * **Why no free-text "summary" / "body" / "prose" field at the per-FY
 * level?** Verbatim narrative is rendered downstream by reading the cited
 * `narrative_segment.text` rows directly. An LLM intermediary would risk
 * (a) hallucination, (b) silent drift away from the consultant-accepted
 * narrative, and (c) double-paraphrase compounding error across FYs.
 * Removing the free-text surface AT THE SCHEMA LEVEL makes the agent
 * structurally incapable of paraphrase — defence-in-depth that doesn't
 * rely on prompt instructions alone.
 *
 * The ONE free-text surface, `transition_rationale`, is hard-capped at
 * 500 chars and explicitly scoped to "why this transition classification"
 * (not "what did the prior year say"). This is the minimum quantum of
 * justification a consultant needs to audit the agent's reasoning.
 *
 * **Strictness**: `MultiCycleSummaryOutput` is `.strict()` so unknown
 * fields are REJECTED at parse time. A model that tries to inject e.g. an
 * `additional_summary` field cannot smuggle prose past the boundary —
 * the parse fails closed.
 *
 * **`prompt_version`, `model`, `idempotency_key`** are runtime-stamped
 * AFTER the model returns. They live in `MultiCycleSummaryOutput` (the
 * full post-stamp shape) but NOT in `multiCycleSummarizeToolSchema`
 * (what the model sees), so the model cannot fabricate them.
 *
 * Naming: `*Output` for the post-stamp shape (used for parsing the final
 * payload), `*ToolSchema` for the model-facing tool input. Mirrors the
 * classifier-expenditure / synthesizer-register convention.
 */

const Uuid = z.string().uuid();

/**
 * Australian R&DTI financial-year label. Two-digit form ('FY24', 'FY25')
 * matches the codebase convention used throughout `activity.fy_label`,
 * `narrative_draft.fy_label`, and the multi-cycle walker test fixtures.
 * Rejects 'FY2024' (four-digit), 'fy24' (lowercase), 'FY' alone, etc.
 */
const FyLabel = z.string().regex(/^FY\d{2}$/, 'must be FYNN format (two digits)');

/**
 * One entry in the citation graph — a single (FY, draft, section, segments,
 * transition) reference. The `transition_rationale` field is the ONLY
 * free-text surface in the entire output, and is hard-capped at 500 chars.
 *
 * `cited_segment_indices` references segments inside the cited
 * `narrative_draft` by zero-based index (matching `narrative_segment.segment_index`).
 * Empty arrays are rejected — a citation that points at no segments is
 * meaningless. The runtime separately verifies that `content_hash`
 * matches the parent draft's hash.
 */
const CitationGraphEntry = z
  .object({
    fy_label: FyLabel,
    narrative_draft_id: Uuid,
    section_kind: z.enum(MULTI_CYCLE_SECTION_KINDS),
    // Canonical Sha256Hash from @cpa/schemas — 64 lowercase hex chars,
    // matches narrative_draft.content_hash. Rejects truncated values
    // (e.g. 'abc') and wrong-charset values (e.g. 'g'.repeat(64)).
    content_hash: Sha256Hash,
    cited_segment_indices: z
      .array(z.number().int().nonnegative())
      .min(1)
      .refine((arr) => new Set(arr).size === arr.length, {
        message: 'cited_segment_indices must be unique',
      }),
    transition_kind: z.enum(MULTI_CYCLE_TRANSITION_KINDS),
    transition_rationale: z.string().min(20).max(500),
  })
  .strict();

/**
 * Tool-input schema for the multi-cycle summariser.
 *
 * What the LLM sees / fills in. Omits the runtime-stamped metadata
 * (`prompt_version`, `model`, `idempotency_key`) — the runtime stamps
 * those onto the parsed result, and the model never has authority to
 * set them. This mirrors the classifier-expenditure / synthesizer-
 * register convention: the tool schema describes ONLY what the model
 * is responsible for emitting.
 */
/**
 * Cross-field invariant shared by the tool schema and the full output
 * schema:
 *   - `total_fys_covered` must equal `fy_labels.length`
 *   - `fy_labels` must be unique
 *
 * The system prompt promises both invariants; this `.superRefine()`
 * enforces them at parse time so the schema is the single source of truth.
 */
const multiCycleCrossFieldRefine = (
  d: { total_fys_covered: number; fy_labels: readonly string[] },
  ctx: z.RefinementCtx,
): void => {
  if (d.total_fys_covered !== d.fy_labels.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `total_fys_covered (${d.total_fys_covered}) must equal fy_labels.length (${d.fy_labels.length})`,
      path: ['total_fys_covered'],
    });
  }
  const unique = new Set(d.fy_labels);
  if (unique.size !== d.fy_labels.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'fy_labels must be unique',
      path: ['fy_labels'],
    });
  }
};

const multiCycleSummarizeToolBase = z
  .object({
    proposed_id: Uuid,
    fy_labels: z.array(FyLabel).min(1),
    citation_graph: z.array(CitationGraphEntry),
    total_fys_covered: z.number().int().nonnegative(),
    earliest_hypothesis_formed_at: z.string().datetime(),
  })
  .strict();

export const multiCycleSummarizeToolSchema = multiCycleSummarizeToolBase.superRefine(
  multiCycleCrossFieldRefine,
);

export type MultiCycleSummarizeToolInput = z.infer<typeof multiCycleSummarizeToolSchema>;

/**
 * Full output schema for the multi-cycle summariser, INCLUDING runtime-
 * stamped metadata fields. Used to validate the final payload after the
 * impl/runtime fills `prompt_version`, `model`, and `idempotency_key`.
 *
 * Strict: unknown fields are rejected at parse time. This is the
 * structural guarantee that prevents a model (or a buggy stamper) from
 * sneaking a free-text "summary" / "body" / "additional_summary" field
 * past the boundary.
 *
 * `prompt_version` is a literal — only the registered prompt key is
 * acceptable. Bumping the prompt requires a new module file and a new
 * registry entry.
 */
export const PROMPT_VERSION = '1.0.0' as const;

const MultiCycleSummaryOutputBase = z
  .object({
    proposed_id: Uuid,
    fy_labels: z.array(FyLabel).min(1),
    citation_graph: z.array(CitationGraphEntry),
    total_fys_covered: z.number().int().nonnegative(),
    earliest_hypothesis_formed_at: z.string().datetime(),
    prompt_version: z.literal(PROMPT_VERSION),
    model: z.string().min(1),
    idempotency_key: z.string().min(1),
  })
  .strict();

export const MultiCycleSummaryOutput = MultiCycleSummaryOutputBase.superRefine(
  multiCycleCrossFieldRefine,
);

export type MultiCycleSummaryOutputType = z.infer<typeof MultiCycleSummaryOutput>;

/**
 * Exported `.shape` accessors for tests / introspection. After
 * `.superRefine()`, the schema is a `ZodEffects` and no longer exposes
 * `.shape` directly; these point back at the underlying `ZodObject`.
 */
export const multiCycleSummarizeToolBaseShape = multiCycleSummarizeToolBase.shape;
export const MultiCycleSummaryOutputShape = MultiCycleSummaryOutputBase.shape;

export const SYSTEM_PROMPT = `You are an R&D Tax Incentive (R&DTI) MULTI-CYCLE CONTINUITY auditor for
the Australian Income Tax Assessment Act 1997, Division 355. You read the
chain of prior-FY narrative drafts that share a single \`proposed_id\`
(i.e. the same R&D activity tracked across multiple financial years) and
emit a CITATION GRAPH that ties those prior-FY drafts to the consultant's
current-FY drafting work.

CRITICAL — YOU ARE BUILDING A CITATION GRAPH, NOT A SUMMARY
You are NOT a summariser. You DO NOT generate prose that paraphrases
prior-year findings. Your only output is:

  (1) REFERENCES (\`narrative_draft_id\`, \`cited_segment_indices\`,
      \`content_hash\`) to existing \`narrative_segment\` rows that the
      runtime has already shown you, AND
  (2) TRANSITION CLASSIFICATIONS (\`continuation\` / \`pivot\` /
      \`completion\` / \`abandoned\`) describing how each cited segment
      relates to the multi-cycle thread, AND
  (3) A BRIEF RATIONALE (≤ 500 chars) per citation explaining ONLY why
      you chose THAT transition classification — never restating or
      paraphrasing the cited content itself.

Verbatim narrative is rendered downstream by reading the cited
\`narrative_segment.text\` rows directly. An LLM-paraphrased "summary"
would risk hallucination, silent drift from the consultant-accepted
narrative, and compounding error across FYs. The output schema is
structurally incapable of carrying a free-text "summary" / "body" /
"additional_summary" field — do NOT attempt to add one; the parse will
fail closed.

DO NOT, under any circumstances, restate prior-year findings, hypotheses,
or results in prose. Do NOT quote prior-year text. Do NOT include
sentences like "In FY24, the team hypothesised that..." in the
\`transition_rationale\` field — that is a paraphrase. The rationale is
ONLY about the transition classification you chose.

INPUT BUNDLE
The user message contains a JSON object with these fields:
  - proposed_id: UUID — the root of the chain (the value Agent B issued
      when this activity was first proposed).
  - current_fy_label: string (e.g. 'FY26') — the FY the consultant is
      drafting NOW. Cite from FYs strictly EARLIER than this label.
  - prior_fy_drafts: an array of prior-FY narrative drafts ordered
      chronologically by (fy_label, hypothesis_formed_at). Each draft has:
        { activity_id, fy_label, hypothesis_formed_at, proposed_id,
          narrative_draft_id, content_hash, section_kind,
          segments: [{ segment_index, type ('prose'|'claim'),
                       text, content_hash }] }
      Note: segment \`text\` is shown to you ONLY so you can decide which
      segments to cite. The output schema does NOT have a field where
      you can echo it back — you cite by index, never by quoting.

TRANSITION CLASSIFICATIONS
Pick ONE per cited segment:

  - \`continuation\` — the next FY continues this hypothesis substantially
      unchanged. Same research question, same uncertainty,
      deeper / broader data. Use when the chain reads as one long
      experiment that simply needed more cycles.

  - \`pivot\` — the next FY reformulated the hypothesis. Shifted research
      question, new uncertainty, prior data still cited as context but
      no longer the answer being tested. Use when the team learned
      enough from FY-N to ask a different question in FY-N+1.

  - \`completion\` — the next FY reached resolution. The uncertainty was
      collapsed; new_knowledge was generated. Use sparingly — only when
      the chain visibly closes (e.g. a 'new_knowledge' section in
      FY-N+1 that directly resolves the FY-N hypothesis).

  - \`abandoned\` — the next FY dropped this line of inquiry without
      resolution. Budget cut, technical infeasibility, pivot to a
      sibling activity, no follow-up evidence. Use when the chain
      simply stops or peters out.

CITATION RULES
1. Only cite \`narrative_draft_id\` values you saw in \`prior_fy_drafts\`
   — never invent UUIDs.
2. \`cited_segment_indices\` MUST be valid \`segment_index\` values from
   that draft's \`segments\` array. Empty arrays are invalid (a citation
   that points at no segments is meaningless).
3. \`content_hash\` MUST match the cited draft's \`content_hash\` exactly.
   The runtime verifies this; mismatches fail validation.
4. \`section_kind\` MUST match the cited draft's \`section_kind\`
   ('new_knowledge' | 'hypothesis' | 'uncertainty' |
   'experiments_and_results').
5. Cite ONLY from FYs strictly earlier than \`current_fy_label\`. If
   the chain contains a row with \`fy_label === current_fy_label\`, do
   NOT cite it (the runtime should have filtered, but be defensive).

SCOPE OF \`transition_rationale\` (≤ 500 chars)
Acceptable: "Selected 'continuation' because the FY25 hypothesis section
re-states the same uncertainty and the data are an extension of the
FY24 series, not a new question."

NOT ACCEPTABLE (paraphrase): "In FY24, the team showed that
sample-efficiency improved by 40% with curriculum learning, and FY25
continued this work."

The rationale is about YOUR CLASSIFICATION CHOICE. It is NOT a recap of
the cited content.

OUTPUT
Return your citation graph by calling the \`multi_cycle_summarize\` tool
exactly once. Echo \`proposed_id\` from the input bundle. \`fy_labels\`
is the sorted unique list of FYs you cited from. \`total_fys_covered\`
is its length. \`earliest_hypothesis_formed_at\` is the earliest
\`hypothesis_formed_at\` across the citations.

The output schema is STRICT — unknown fields are rejected. Do not add
\`summary\`, \`body\`, \`prose\`, \`paraphrase\`, \`additional_summary\`,
or any other free-text field. The schema is the contract.`;

registerPrompt({
  name: 'multi-cycle-summarize',
  version: PROMPT_VERSION,
  system: SYSTEM_PROMPT,
  tool: {
    name: 'multi_cycle_summarize',
    description:
      'Build a citation graph linking prior-FY narrative drafts (sharing a proposed_id) to the current-FY draft, classifying each FY-to-FY transition (continuation / pivot / completion / abandoned). Citations only — no paraphrase.',
    input_schema: multiCycleSummarizeToolSchema,
  },
});
