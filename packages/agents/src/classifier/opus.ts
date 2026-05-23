import { getAnthropicClient } from '../runtime/anthropic-client.js';
import { getPrompt } from '../runtime/prompt-registry.js';
import { callWithToolUse } from '../runtime/tool-use.js';
import './prompts/classify@1.0.0.js'; // side-effect: registers the prompt
import type { Classifier, ClassifierInput, ClassifierOutput } from './types.js';

const MODEL = process.env.CLASSIFIER_MODEL ?? 'claude-opus-4-7';
const PROMPT_KEY = 'classify@1.0.0';

/**
 * Production classifier backed by the Anthropic SDK + Claude Opus.
 *
 * Previously this was a Haiku-backed implementation; in benchmark runs
 * against the bulk-claims contamination corpus, Haiku was leaking
 * ~35 % of corporate-noise notes back into the claim (Div 355
 * "ordinary business operations" exclusion). The deeper reasoning of
 * Opus catches the borderline cases — marketing experiments, refactor
 * chores, board prep — where Haiku tends to default to the
 * SUPPORTING / OBSERVATION classes.
 *
 * The MODEL constant reads `CLASSIFIER_MODEL` so deployments can pin
 * a specific Opus point release (or drop to Haiku for cost-sensitive
 * fallback) without a code change.
 *
 * The `import './prompts/classify@1.0.0.js'` side-effect import is
 * what registers the versioned prompt with the runtime registry —
 * without it `getPrompt(PROMPT_KEY)` would throw on the first
 * classify() call.
 */
export class OpusClassifier implements Classifier {
  async classify(input: ClassifierInput): Promise<ClassifierOutput> {
    const prompt = getPrompt<{
      kind: ClassifierOutput['kind'];
      confidence: number;
      rationale: string;
      statutory_anchor: string | null;
    }>(PROMPT_KEY);
    const { output, tokens_in, tokens_out } = await callWithToolUse(getAnthropicClient(), {
      model: MODEL,
      system: prompt.system,
      user: input.raw_text,
      tool: prompt.tool,
    });
    return {
      ...output,
      model: MODEL,
      prompt_version: PROMPT_KEY,
      tokens_in,
      tokens_out,
    };
  }
}
