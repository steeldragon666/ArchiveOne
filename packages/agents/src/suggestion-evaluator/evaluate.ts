import type Anthropic from '@anthropic-ai/sdk';
import type { PromptSuggestionEvaluation } from './types.js';

/**
 * Local structural interface for the suggestion shape this evaluator
 * consumes. Identical shape to `PromptSuggestionForChoreography` in
 * `@cpa/integrations/github-app`, but cannot be imported from there
 * because adding `@cpa/integrations` as a dependency of `@cpa/agents`
 * would create a TypeScript project-reference cycle (integrations
 * already depends on agents).
 *
 * TODO(#28): once prompt-suggestion enums + input schemas are
 * promoted to `@cpa/schemas`, replace this with the canonical type
 * from there. Until that lands, the structural-typing equivalence
 * means a real `PromptSuggestionForChoreography` value satisfies this
 * interface at the call site, with no runtime cost.
 */
export interface EvaluateSuggestionInput {
  id: string;
  tenant_id: string;
  flagged_by_user_id: string;
  source_kind: 'consultant_flag' | 'rif_event' | 'contract_test_failure' | 'reviewer_disposition';
  affected_prompt_module: string | null;
  affected_section_kind: string | null;
  issue_summary: string;
}

export interface EvaluateInput {
  suggestion: EvaluateSuggestionInput;
  repoRoot: string;
  /** DI seam — defaults to a lazy `getAnthropicClient()` from runtime/anthropic-client.ts. */
  anthropic?: Anthropic;
  /** Defaults to `'claude-opus-4-7'`. */
  model?: string;
  /** Cap on tool-use loop iterations. Defaults to 12. */
  maxTurns?: number;
  /** AbortSignal so the 5-min handler timeout can interrupt the call. */
  signal?: AbortSignal;
}

/**
 * Production evaluator: takes a prompt-suggestion + repo root, runs the
 * Anthropic-driven tool-use loop with the SYSTEM_PROMPT and read-only
 * repo tools, returns the proposed change set.
 *
 * The handler at apps/api/src/routes/prompt-suggestions.ts:739 calls
 * this through the `deps.evaluate` injection point; production wiring
 * lives in apps/api/src/server.ts.
 *
 * Throws structured errors so the handler error map (line 845-870)
 * can produce the right HTTP code + structured detail.
 */
export async function evaluate(_input: EvaluateInput): Promise<PromptSuggestionEvaluation> {
  // Skeleton — implementation lands in Task 2. The `await` keeps the
  // function genuinely async so callers see a rejected promise rather
  // than a synchronous throw; remove once the loop body lands.
  await Promise.resolve();
  throw new Error('evaluate(): not yet implemented (Task 2 of issue #27 plan)');
}

export class EvaluatorConfigError extends Error {
  override readonly name = 'EvaluatorConfigError';
}
export class EvaluatorUpstreamError extends Error {
  override readonly name = 'EvaluatorUpstreamError';
}
export class EvaluatorParseError extends Error {
  override readonly name = 'EvaluatorParseError';
  /** First 500 chars of the unparseable response, for triage. Truncated by the constructor. */
  readonly rawSnippet: string;
  constructor(message: string, rawSnippet: string) {
    super(message);
    this.rawSnippet = rawSnippet.slice(0, 500);
  }
}
export class EvaluatorLoopExhaustedError extends Error {
  override readonly name = 'EvaluatorLoopExhaustedError';
  readonly turnsUsed: number;
  constructor(message: string, turnsUsed: number) {
    super(message);
    this.turnsUsed = turnsUsed;
  }
}
