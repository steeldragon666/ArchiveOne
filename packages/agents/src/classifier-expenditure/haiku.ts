import { getAnthropicClient } from '../runtime/anthropic-client.js';
import { getPrompt } from '../runtime/prompt-registry.js';
import { callWithToolUse } from '../runtime/tool-use.js';
import './prompts/classify-expenditure@1.0.0.js'; // side-effect: registers the prompt
import type { ClassifyExpenditureToolInput } from './prompts/classify-expenditure@1.0.0.js';
import type {
  ExpenditureClassifier,
  ExpenditureClassifierInput,
  ExpenditureClassifierOutput,
} from './types.js';

const PROMPT_KEY = 'classify-expenditure@1.0.0';

/**
 * Production expenditure classifier backed by the Anthropic SDK + Claude Haiku.
 *
 * Mirrors the structure of `classifier/haiku.ts`:
 *   - The `import './prompts/classify-expenditure@1.0.0.js'` side-effect import
 *     is what registers the versioned prompt with the runtime registry.
 *   - The model is forced to invoke the `classify_expenditure` tool and the
 *     result is re-parsed through the zod schema by `callWithToolUse`.
 *
 * The MODEL constant is read on each `classify()` invocation (not at module
 * load) so tests that set `EXPENDITURE_CLASSIFIER_MODEL` after import still
 * propagate. The runtime stamps `model`, `prompt_version`, `tokens_in`,
 * `tokens_out` — the model never sees or sets them.
 *
 * Defense-in-depth: if the model echoes back a different `expenditure_id`
 * than the input, we throw rather than silently corrupt downstream events.
 */
export class HaikuExpenditureClassifier implements ExpenditureClassifier {
  async classify(input: ExpenditureClassifierInput): Promise<ExpenditureClassifierOutput> {
    const model = process.env.EXPENDITURE_CLASSIFIER_MODEL ?? 'claude-haiku-4-5';
    const prompt = getPrompt<ClassifyExpenditureToolInput>(PROMPT_KEY);
    // Serialise the entire input bundle as the user message — the system
    // prompt teaches the model the JSON shape.
    const userMessage = JSON.stringify(input);
    const { output, tokens_in, tokens_out } = await callWithToolUse(getAnthropicClient(), {
      model,
      system: prompt.system,
      user: userMessage,
      tool: prompt.tool,
    });
    if (output.expenditure_id !== input.expenditure_id) {
      throw new Error(
        `classifier echoed wrong expenditure_id; possible model confusion (expected=${input.expenditure_id}, got=${output.expenditure_id})`,
      );
    }
    return {
      expenditure_id: output.expenditure_id,
      decision: output.decision,
      eligibility_probability: output.eligibility_probability,
      statutory_anchor: output.statutory_anchor,
      suggested_activity_id: output.suggested_activity_id,
      rationale: output.rationale,
      uncertainty_reason: output.uncertainty_reason,
      model,
      prompt_version: PROMPT_KEY,
      tokens_in,
      tokens_out,
    };
  }
}
