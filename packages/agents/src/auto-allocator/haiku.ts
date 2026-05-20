import { getAnthropicClient } from '../runtime/anthropic-client.js';
import { getPrompt } from '../runtime/prompt-registry.js';
import { callWithToolUse } from '../runtime/tool-use.js';
import './prompts/allocate@1.0.0.js'; // side-effect: registers the prompt
import type { AutoAllocator, AutoAllocatorInput, AutoAllocatorOutput } from './types.js';
import type { AllocateToolInput } from './prompts/allocate@1.0.0.js';

const MODEL = process.env.ALLOCATOR_MODEL ?? 'claude-haiku-4-5';
const PROMPT_KEY = 'allocate@1.0.0';

/**
 * Production auto-allocator backed by the Anthropic SDK + Claude Haiku.
 *
 * The side-effect import above registers the prompt before the first
 * `allocate()` call; without it `getPrompt(PROMPT_KEY)` throws.
 */
export class HaikuAutoAllocator implements AutoAllocator {
  async allocate(input: AutoAllocatorInput): Promise<AutoAllocatorOutput> {
    const prompt = getPrompt<AllocateToolInput>(PROMPT_KEY);

    // Build the user message: classification summary + activities list.
    const activitiesList = input.activities
      .map(
        (a) =>
          `- activity_id: ${a.id}\n  code: ${a.code}\n  kind: ${a.kind}\n  title: ${a.title}\n  hypothesis: ${a.hypothesis ?? '(none)'}`,
      )
      .join('\n');

    const userMessage = `## Evidence text\n${input.raw_text}\n\n## Classification\nkind: ${input.classification.kind}\nconfidence: ${input.classification.confidence}\nrationale: ${input.classification.rationale}\nstatutory_anchor: ${input.classification.statutory_anchor ?? 'none'}\n\n## Registered activities\n${activitiesList}`;

    const { output, tokens_in, tokens_out } = await callWithToolUse(getAnthropicClient(), {
      model: MODEL,
      system: prompt.system,
      user: userMessage,
      tool: prompt.tool,
      max_tokens: 512,
    });

    if (output.unallocated) {
      return {
        unallocated: true,
        rationale: output.rationale,
        model: MODEL,
        prompt_version: PROMPT_KEY,
        tokens_in,
        tokens_out,
      };
    }

    return {
      unallocated: false,
      activity_id: output.activity_id,
      activity_code: output.activity_code,
      confidence: output.confidence,
      rationale: output.rationale,
      model: MODEL,
      prompt_version: PROMPT_KEY,
      tokens_in,
      tokens_out,
    };
  }
}
