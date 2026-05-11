import { getAnthropicClient } from '../runtime/anthropic-client.js';
import { getPrompt } from '../runtime/prompt-registry.js';
import { callWithToolUse } from '../runtime/tool-use.js';
import './prompts/summarize-narrative@1.0.0.js'; // side-effect: registers the prompt
import type {
  NarrativeSummarizer,
  NarrativeSummarizerInput,
  NarrativeSummarizerOutput,
} from './types.js';
import type { SummarizeNarrativeToolOutput } from './prompts/summarize-narrative@1.0.0.js';

// TODO: verify this model ID is the latest Opus available — update when
// Anthropic releases a newer Opus revision. The env var override allows
// callers to pin a specific model without a code change.
const MODEL = process.env.NARRATIVE_SUMMARIZER_MODEL ?? 'claude-opus-4-5-20250929';
const PROMPT_KEY = 'summarize-narrative@1.0.0';

// Narrative summaries are short structured outputs; 2048 tokens is generous
// headroom for the tool-use response without risking hitting the context limit.
const MAX_TOKENS = 2048;

/**
 * Production narrative summarizer backed by the Anthropic SDK + Claude Opus.
 *
 * Uses the same tool-use pattern as HaikuDocumentAnalyzer to force structured
 * JSON output. The model choice is Opus (rather than Haiku) because the
 * narrative paragraph needs to be coherent, technically precise, and
 * in the register of a senior Australian R&DTI consultant — a task that
 * rewards stronger reasoning capacity.
 *
 * The side-effect import above registers the prompt before the first
 * summarize() call; without it `getPrompt(PROMPT_KEY)` throws.
 */
export class OpusNarrativeSummarizer implements NarrativeSummarizer {
  async summarize(input: NarrativeSummarizerInput): Promise<NarrativeSummarizerOutput> {
    const prompt = getPrompt<SummarizeNarrativeToolOutput>(PROMPT_KEY);

    // Format document summaries section.
    const docSection =
      input.document_summaries.length > 0
        ? input.document_summaries.map((d, i) => `${i + 1}. ${d.filename}: ${d.summary}`).join('\n')
        : '(no documents)';

    // Format proposed activities section.
    const actSection =
      input.proposed_activities.length > 0
        ? input.proposed_activities
            .map(
              (a, i) =>
                `${i + 1}. [${a.kind.toUpperCase()}] ${a.name} (confidence ${a.confidence.toFixed(2)})\n   Hypothesis: ${a.hypothesis.slice(0, 200)}`,
            )
            .join('\n')
        : '(no proposed activities)';

    // Format proposed invoices section.
    const invSection =
      input.proposed_invoices.length > 0
        ? input.proposed_invoices
            .map(
              (inv, i) =>
                `${i + 1}. ${inv.vendor}: $${inv.total_aud.toLocaleString('en-AU', { minimumFractionDigits: 2 })} AUD (confidence ${inv.confidence.toFixed(2)})`,
            )
            .join('\n')
        : '(no proposed invoices)';

    const userMessage = [
      `## Client: ${input.subject_tenant_name}`,
      ``,
      `## Document summaries (${input.document_summaries.length} documents)`,
      docSection,
      ``,
      `## Proposed R&D activities (${input.proposed_activities.length} total)`,
      actSection,
      ``,
      `## Proposed invoices / expenditure (${input.proposed_invoices.length} total)`,
      invSection,
    ].join('\n');

    const { output } = await callWithToolUse(getAnthropicClient(), {
      model: MODEL,
      system: prompt.system,
      user: userMessage,
      tool: prompt.tool,
      max_tokens: MAX_TOKENS,
    });

    return {
      narrative: output.narrative,
      total_aud: output.total_aud,
      core_count: output.core_count,
      supporting_count: output.supporting_count,
      invoice_count: output.invoice_count,
      document_count: output.document_count,
    };
  }
}
