/**
 * Agent C (narrative drafter) streaming orchestrator.
 *
 * Wraps Anthropic's streaming tool-use API into a clean async-generator
 * surface. The model emits `emit_segment` tool calls; this orchestrator
 * normalises each completed `tool_use` content block into a
 * {@link NarrativeSegment}, runs {@link validateSegment} against the
 * activity's clustered-event scope, and either:
 *
 *   - yields a `{type:'segment'}` event (validation passed), or
 *   - swallows the segment, drops a correction message into the message
 *     history, and re-streams a fresh assistant turn (validation failed).
 *
 * On exhaustion of the global correction budget the offending segment is
 * downgraded to `prose` (preserving its text), `validation_downgraded_count`
 * is incremented, and the run continues.
 *
 * # Correction-retry scoping
 *
 * The retry counter is GLOBAL across the whole stream, not per-segment.
 * Rationale: Anthropic's streaming protocol re-streams a whole assistant
 * turn after a correction message; per-segment counters would let a
 * pathological model burn the budget on segment N + still have a fresh
 * budget for segment N+1, multiplying worst-case cost. The global cap
 * keeps total correction passes bounded at MAX_CORRECTION_RETRIES (= 2)
 * regardless of how many distinct segments fail.
 *
 * # Event emission
 *
 * The generator yields:
 *   - one `segment` event per validated (or downgraded) segment, in emit
 *     order;
 *   - one `section_complete` per target section once the whole stream
 *     finishes cleanly (segments accumulate into `segmentsBySection`
 *     across correction retries);
 *   - one `done` event with token totals + `validation_downgraded_count`;
 *   - one `error` event on abort or transport failure (NO `done` after
 *     `error`).
 *
 * # Telemetry
 *
 * Wraps the whole call in `withAgentSpan('narrative-drafter', …)` so the
 * span auto-derives `cpa.cost_usd` from accumulated `tokens_in/out` once
 * `done` is reached. Mid-stream token counts are folded into setAttr at
 * the end of each model turn (Anthropic emits cumulative `output_tokens`
 * on `message_delta` and the per-turn `input_tokens` on `message_start`).
 */

import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '../runtime/anthropic-client.js';
import { getPrompt } from '../runtime/prompt-registry.js';
import { withAgentSpan } from '../runtime/telemetry.js';
import {
  draftNarrativeToolSchema,
  EMIT_SEGMENT_TOOL_NAME,
  EMIT_SEGMENT_TOOL_DESCRIPTION,
  type DraftNarrativeToolInput,
} from './prompts/segment-schema.js';
import './prompts/draft-narrative@1.0.0.js'; // side-effect: register prompt
import './prompts/regenerate-section@1.0.0.js'; // side-effect: register prompt
import { validateSegment, type NarrativeSegment } from './validate.js';
import { SECTION_KINDS, type SectionKind } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ActivityContext = {
  id: string;
  name: string;
  kind: 'core' | 'supporting';
  statutory_anchor: 's.355-25' | 's.355-30';
  project_id: string;
};

export type ProjectContext = {
  id: string;
  name: string;
  industry_sector: string | null;
  fiscal_year: number;
};

/**
 * Compressed event slice handed to Agent C. Mirrors the slice the
 * synthesizer (Task 4.x) produces; redeclared locally because the
 * synthesizer module does not yet exist on this branch (Task 5.4 lands
 * before 4.2's Sonnet impl). When 4.2 lands, both modules can converge
 * on a shared declaration in `src/synthesizer-register/types.ts`.
 */
export type CompressedEvent = {
  id: string;
  kind: string;
  captured_at: string;
  summary: string;
};

export type StreamNarrativeDraftInput = {
  activity: ActivityContext;
  project: ProjectContext;
  clustered_events: CompressedEvent[];
  prefill: { proposed_hypothesis?: string; proposed_uncertainty?: string } | null;
  existing_sections: Record<SectionKind, NarrativeSegment[]> | null;
  target_section_kinds: SectionKind[];
  abortSignal: AbortSignal;
};

/**
 * Discriminated union of events the generator yields. Mirrors the SSE
 * frame protocol the API route serialises to the client.
 */
export type StreamEvent =
  | {
      type: 'segment';
      section_kind: SectionKind;
      segment_index: number;
      segment: NarrativeSegment;
    }
  | {
      type: 'section_complete';
      section_kind: SectionKind;
      segment_count: number;
      claim_count: number;
    }
  | {
      type: 'done';
      total_segments: number;
      total_claims: number;
      validation_downgraded_count: number;
      tokens_in: number;
      tokens_out: number;
      model: string;
      prompt_version: string;
    }
  | { type: 'error'; reason: string; retryable: boolean };

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const MAX_CORRECTION_RETRIES = 2;
const DEFAULT_MAX_TOKENS = 8192;
const NARRATIVE_DRAFTER_MODEL = process.env.NARRATIVE_DRAFTER_MODEL ?? 'claude-sonnet-4-5';

/**
 * Test-only override for the Anthropic client returned to the
 * orchestrator. When set, replaces the lazy SDK singleton from
 * `getAnthropicClient()` for the duration of the run; production code
 * never sets this.
 *
 * The streaming SDK's wire protocol is non-trivial to mock through
 * nock (SSE framing, internal accumulators, partial JSON parser);
 * letting tests inject a stub client whose `messages.stream(...)`
 * returns a hand-crafted async-iterable is dramatically simpler and
 * keeps tests free of network plumbing.
 */
type StreamingClientLike = {
  messages: {
    stream: (
      params: Anthropic.MessageStreamParams,
      options?: { signal?: AbortSignal },
    ) => AsyncIterable<Anthropic.MessageStreamEvent>;
  };
};

let testClientOverride: StreamingClientLike | null = null;

/** Set a test-only client override. Call with `null` to clear. */
export function _setStreamingClientForTests(c: StreamingClientLike | null): void {
  testClientOverride = c;
}

type ToolUseBlockNormalised = {
  id: string;
  name: string;
  input: unknown;
};

/**
 * Build the user-message body bundling the input context as a JSON
 * payload the model can read off `input.X`. The system prompt
 * (registered alongside this file) describes the bundle's shape so the
 * model knows how to deserialise it.
 */
function buildUserMessage(input: StreamNarrativeDraftInput, isRegenerate: boolean): string {
  // Strip transient/AbortSignal-shaped fields so JSON.stringify doesn't
  // explode on circular wrappers and the bundle stays deterministic for
  // prompt-cache eligibility.
  const bundle: Record<string, unknown> = {
    activity: input.activity,
    project: input.project,
    clustered_events: input.clustered_events,
    prefill: input.prefill,
    target_section_kinds: input.target_section_kinds,
  };
  if (isRegenerate) {
    bundle.existing_sections = input.existing_sections ?? {};
  }
  return [
    isRegenerate
      ? 'Regenerate the requested section. Input bundle:'
      : 'Draft the four narrative sections. Input bundle:',
    '```json',
    JSON.stringify(bundle, null, 2),
    '```',
  ].join('\n');
}

/**
 * Normalised outcome of streaming one assistant turn.
 *
 *   - `validationFailure: null` → stream completed with all tool_use
 *     blocks accepted (or none emitted). The caller breaks the
 *     correction loop.
 *   - `validationFailure: <details>` → at least one block failed
 *     validation; the caller appends the model's actual assistant turn
 *     and a correction user message, then re-streams.
 */
type TurnResult = {
  tokens_in: number;
  tokens_out: number;
  /**
   * The assistant content blocks the model produced this turn, in
   * Anthropic SDK shape. We replay them verbatim into the next
   * conversation turn so the model sees its own state when applying
   * the correction. Includes ALL emitted tool_use blocks even if
   * subsequent ones were not validated — replaying the full turn keeps
   * the conversation well-formed.
   */
  assistant_blocks: Anthropic.ContentBlock[];
  validation_failure: {
    section_kind: SectionKind;
    segment_index: number;
    reason: string;
    /** Best-effort recovery payload for downgrade-to-prose path. */
    failed_text: string;
  } | null;
};

/**
 * Accumulator wrapping the per-section segment buffer + claim counter
 * the orchestrator threads through correction retries. Hoisted out of
 * the generator body so the inner streaming function can mutate it.
 */
type StreamState = {
  segmentsBySection: Map<SectionKind, NarrativeSegment[]>;
  total_claims: number;
  validation_downgraded_count: number;
  /**
   * Tracks the (section_kind, segment_index) pairs already YIELDED to
   * the consumer this run, so a re-streamed turn that re-emits prior
   * segments does not double-yield. Indexed as `${kind}:${idx}`.
   */
  yielded_keys: Set<string>;
};

function keyOf(kind: SectionKind, idx: number): string {
  return `${kind}:${idx}`;
}

/**
 * Stream ONE assistant turn from Anthropic's messages.stream API.
 *
 * Iterates `RawMessageStreamEvent`s, accumulating `input_json_delta`
 * chunks per content-block index, parses each completed tool_use block
 * via the wire-format Zod schema, runs `validateSegment` on it, and
 * either:
 *
 *   - pushes onto `state.segmentsBySection` + emits a `segment`
 *     StreamEvent through `emit`, or
 *   - records the first-encountered validation failure on
 *     `validation_failure` and stops yielding further segments this
 *     turn (the orchestrator loop will run a correction pass).
 *
 * Letting the stream finish the in-flight turn (rather than aborting
 * mid-turn on first failure) is a deliberate cost trade: the tokens
 * are already burned, and a clean SDK-side close avoids leaving the
 * connection half-open for the next call. Validation failures after
 * the first are still buffered — they'll be re-validated on the next
 * pass once the model retries the section.
 *
 * NOTE: this function does NOT push events onto `emit` for the
 * correction or done lifecycle — it only emits per-segment events for
 * accepted segments. Lifecycle events are the caller's responsibility.
 */
async function streamOneTurn(
  client: StreamingClientLike,
  messages: Anthropic.MessageParam[],
  systemPrompt: string,
  model: string,
  abortSignal: AbortSignal,
  clusteredEventIds: ReadonlySet<string>,
  state: StreamState,
  emit: (ev: StreamEvent) => void,
): Promise<TurnResult> {
  // Fully-buffered JSON for each content block in the running turn,
  // keyed by the SDK's `index` field (which is per-content-block, not
  // per-turn).
  const partialJsonByIndex = new Map<number, string>();
  // Track which indices are tool_use vs text so we know what to parse
  // on `content_block_stop`.
  const toolUseStartByIndex = new Map<number, Anthropic.ToolUseBlock>();
  // Completed (parsed) blocks accumulated this turn — replayed in the
  // next conversation turn on validation failure so the model sees its
  // own prior output.
  const completedBlocks: Anthropic.ContentBlock[] = [];

  let tokens_in = 0;
  let tokens_out = 0;
  let validation_failure: TurnResult['validation_failure'] = null;

  const stream = client.messages.stream(
    {
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      system: systemPrompt,
      messages,
      tools: [
        {
          name: EMIT_SEGMENT_TOOL_NAME,
          description: EMIT_SEGMENT_TOOL_DESCRIPTION,
          // The wire-format zod schema is converted into JSON schema by
          // the prompt-registry / tool-use plumbing in the non-streaming
          // path. For the streaming path we let the SDK accept a
          // permissive schema — Anthropic's API requires a JSON schema
          // here, and the runtime Zod parse on each completed tool_use
          // block (below) is the authoritative structural check.
          input_schema: {
            type: 'object',
            properties: {},
            additionalProperties: true,
          },
        },
      ],
    },
    { signal: abortSignal },
  );

  for await (const event of stream) {
    if (abortSignal.aborted) {
      // Defensive: SDK should already throw on the next iteration when
      // signal aborts, but guard so we don't keep buffering.
      throw new DOMException('Aborted', 'AbortError');
    }

    switch (event.type) {
      case 'message_start': {
        tokens_in = event.message.usage.input_tokens ?? 0;
        // Note: `output_tokens` is also populated on `message_start`
        // but is the cumulative count *to that point* (typically 0).
        tokens_out = event.message.usage.output_tokens ?? 0;
        break;
      }
      case 'content_block_start': {
        if (event.content_block.type === 'tool_use') {
          toolUseStartByIndex.set(event.index, event.content_block);
          partialJsonByIndex.set(event.index, '');
        }
        break;
      }
      case 'content_block_delta': {
        if (event.delta.type === 'input_json_delta') {
          const prev = partialJsonByIndex.get(event.index) ?? '';
          partialJsonByIndex.set(event.index, prev + event.delta.partial_json);
        }
        // text_delta is ignored — the prompt forbids free-form text.
        break;
      }
      case 'content_block_stop': {
        const startBlock = toolUseStartByIndex.get(event.index);
        if (!startBlock) break; // text block: nothing to parse here.

        const buffered = partialJsonByIndex.get(event.index) ?? '';
        // Fully-formed input arrives across deltas; parse the whole
        // buffer at stop. Empty-input tool calls (zero deltas) are
        // possible for tools with empty schemas; here the schema
        // forbids that and the parse will fail downstream.
        let parsedInput: unknown;
        try {
          parsedInput = buffered.length > 0 ? JSON.parse(buffered) : {};
        } catch (_err) {
          // Malformed JSON from the model — record as a validation
          // failure so the correction loop fires.
          if (validation_failure === null) {
            validation_failure = {
              section_kind: SECTION_KINDS[0],
              segment_index: 0,
              reason: 'tool_use input was not valid JSON',
              failed_text: buffered.slice(0, 500),
            };
          }
          completedBlocks.push({ ...startBlock, input: {} });
          break;
        }

        // Replay this block in the next turn even if validation fails;
        // the conversation needs the assistant's actual content for
        // Anthropic to accept the next user-correction message.
        const echoedBlock: Anthropic.ContentBlock = { ...startBlock, input: parsedInput };
        completedBlocks.push(echoedBlock);

        const normalised: ToolUseBlockNormalised = {
          id: startBlock.id,
          name: startBlock.name,
          input: parsedInput,
        };

        const handled = await handleCompletedToolUse(normalised, clusteredEventIds, state, emit);
        if (!handled.ok && validation_failure === null) {
          validation_failure = handled.failure;
        }
        break;
      }
      case 'message_delta': {
        // `message_delta.usage.output_tokens` is cumulative for the
        // turn; overwrite rather than add.
        if (event.usage?.output_tokens !== undefined) {
          tokens_out = event.usage.output_tokens;
        }
        break;
      }
      case 'message_stop': {
        // Nothing to do — finalisation happens after the loop.
        break;
      }
      default: {
        // Unknown future event types — ignore. The protocol is
        // designed for forward compatibility.
        break;
      }
    }
  }

  return {
    tokens_in,
    tokens_out,
    assistant_blocks: completedBlocks,
    validation_failure,
  };
}

/**
 * Process one completed tool_use block:
 *   1. Wire-format Zod parse (rejects e.g. wrong types, missing fields).
 *   2. Validate against clustered-event scope via `validateSegment`.
 *   3. If accepted, dedupe against already-yielded keys, accumulate,
 *      and emit a `segment` StreamEvent.
 *   4. If rejected, return the failure record so the caller can route
 *      it to the correction loop.
 */
async function handleCompletedToolUse(
  block: ToolUseBlockNormalised,
  clusteredEventIds: ReadonlySet<string>,
  state: StreamState,
  emit: (ev: StreamEvent) => void,
): Promise<
  | { ok: true }
  | {
      ok: false;
      failure: NonNullable<TurnResult['validation_failure']>;
    }
> {
  // Async-fn signature is kept for symmetry with the future case where
  // we want to await side-effects (telemetry, persistence). For now the
  // body is synchronous; the await Promise.resolve() is purely to make
  // typescript-eslint happy with require-await.
  await Promise.resolve();
  if (block.name !== EMIT_SEGMENT_TOOL_NAME) {
    return {
      ok: false,
      failure: {
        section_kind: SECTION_KINDS[0],
        segment_index: 0,
        reason: `unknown tool ${block.name}; expected ${EMIT_SEGMENT_TOOL_NAME}`,
        failed_text: '',
      },
    };
  }

  const parseResult = draftNarrativeToolSchema.safeParse(block.input);
  if (!parseResult.success) {
    const flat = parseResult.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    // Best-effort introspection so we can target the correction
    // message at the right (section_kind, segment_index).
    const raw = (block.input ?? {}) as Record<string, unknown>;
    return {
      ok: false,
      failure: {
        section_kind: (raw.section_kind as SectionKind) ?? SECTION_KINDS[0],
        segment_index: typeof raw.segment_index === 'number' ? raw.segment_index : 0,
        reason: `tool_use input failed wire-format validation: ${flat}`,
        failed_text: typeof raw.text === 'string' ? raw.text : '',
      },
    };
  }

  const wire: DraftNarrativeToolInput = parseResult.data;
  const segment: NarrativeSegment =
    wire.type === 'prose'
      ? { type: 'prose', text: wire.text }
      : { type: 'claim', text: wire.text, citing_events: wire.citing_events };

  const validation = validateSegment(segment, clusteredEventIds);
  if (!validation.ok) {
    return {
      ok: false,
      failure: {
        section_kind: wire.section_kind,
        segment_index: wire.segment_index,
        reason: validation.reason,
        failed_text: wire.text,
      },
    };
  }

  // Dedupe: if this (kind, idx) was already yielded on a prior turn,
  // skip — the model legitimately re-emits earlier segments after a
  // correction pass and we don't want to double-yield.
  const k = keyOf(wire.section_kind, wire.segment_index);
  if (state.yielded_keys.has(k)) {
    return { ok: true };
  }
  state.yielded_keys.add(k);

  // Accumulate. Keyed buffer ensures `section_complete` later reports
  // the right counts.
  const buf = state.segmentsBySection.get(wire.section_kind) ?? [];
  buf.push(segment);
  state.segmentsBySection.set(wire.section_kind, buf);
  if (segment.type === 'claim') state.total_claims += 1;

  emit({
    type: 'segment',
    section_kind: wire.section_kind,
    segment_index: wire.segment_index,
    segment,
  });
  return { ok: true };
}

/**
 * Build the Anthropic-side content for the user-correction message
 * that nudges the model to re-emit a failed segment correctly.
 */
function correctionUserMessage(failure: NonNullable<TurnResult['validation_failure']>): string {
  return [
    `Your segment_index ${failure.segment_index} for section ${failure.section_kind} failed validation: ${failure.reason}.`,
    'Re-emit it correctly. Do not change segments that already validated; resume emission from the failed segment forward.',
  ].join(' ');
}

/**
 * Force a 5xx-shaped error to manifest as the well-known error label
 * downstream consumers branch on. Matches the convention in
 * `synthesizer-register/sonnet.ts` (Task 4.2) once it lands.
 */
function classifyError(
  err: unknown,
  abortSignal: AbortSignal,
): {
  reason: string;
  retryable: boolean;
} {
  if (abortSignal.aborted) {
    return { reason: 'aborted', retryable: false };
  }
  // AbortError can also be thrown by the SDK when the signal fires
  // mid-stream even if abortSignal.aborted hasn't propagated yet.
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError')) {
    return { reason: 'aborted', retryable: false };
  }
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: number }).status;
    if (typeof status === 'number' && status >= 500 && status < 600) {
      return { reason: 'anthropic_5xx', retryable: true };
    }
    if (typeof status === 'number' && status === 429) {
      return { reason: 'anthropic_rate_limited', retryable: true };
    }
  }
  return { reason: err instanceof Error ? err.message : String(err), retryable: false };
}

// ---------------------------------------------------------------------------
// Public generator
// ---------------------------------------------------------------------------

/**
 * Stream Agent C narrative segments for one or more target sections.
 *
 * See module-level JSDoc for the validate-and-correct loop semantics
 * and StreamEvent ordering guarantees.
 */
export async function* streamNarrativeDraft(
  input: StreamNarrativeDraftInput,
): AsyncGenerator<StreamEvent> {
  const isRegenerate = input.existing_sections != null && input.target_section_kinds.length === 1;
  const promptKey = isRegenerate ? 'regenerate-section@1.0.0' : 'draft-narrative@1.0.0';
  const prompt = getPrompt<DraftNarrativeToolInput>(promptKey);
  const model = NARRATIVE_DRAFTER_MODEL;

  const clusteredEventIds: ReadonlySet<string> = new Set(input.clustered_events.map((e) => e.id));

  const state: StreamState = {
    segmentsBySection: new Map(),
    total_claims: 0,
    validation_downgraded_count: 0,
    yielded_keys: new Set(),
  };

  // Hold on to events the inner streaming function emits and re-yield
  // them from the outer generator. (Generators cannot delegate `yield`
  // through a regular async function, so we buffer + drain.)
  const eventQueue: StreamEvent[] = [];
  const emit = (ev: StreamEvent): void => {
    eventQueue.push(ev);
  };

  const userMessage = buildUserMessage(input, isRegenerate);
  let conversation: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

  let total_tokens_in = 0;
  let total_tokens_out = 0;

  // ── Telemetry-wrapped run. Span auto-derives cpa.cost_usd once
  // tokens_in/out are recorded via setAttr at the end of the run.
  // We collect every StreamEvent into `outEvents` inside the span and
  // re-yield them outside; the span captures *the whole run*, including
  // correction retries.
  type RunOutcome = {
    events: StreamEvent[];
  };
  let runOutcome: RunOutcome;

  try {
    runOutcome = await withAgentSpan(
      'narrative-drafter',
      {
        agent_name: 'narrative-drafter',
        prompt_version: promptKey,
        model,
      },
      async (setAttr) => {
        const out: StreamEvent[] = [];
        const drainQueue = (): void => {
          while (eventQueue.length > 0) {
            // Non-null assertion is safe under the loop guard.
            out.push(eventQueue.shift() as StreamEvent);
          }
        };

        const client: StreamingClientLike = testClientOverride ?? getAnthropicClient();
        let correction_retries = 0;

        while (true) {
          const result = await streamOneTurn(
            client,
            conversation,
            prompt.system,
            model,
            input.abortSignal,
            clusteredEventIds,
            state,
            emit,
          );
          drainQueue();
          total_tokens_in += result.tokens_in;
          total_tokens_out += result.tokens_out;

          if (result.validation_failure === null) {
            break;
          }

          if (correction_retries >= MAX_CORRECTION_RETRIES) {
            // Downgrade the failed segment to prose. Preserves text,
            // strips the claim semantics (no citing_events), bumps
            // the downgrade counter so the UI can render a yellow
            // warning. Subsequent segments from the model are
            // discarded — the correction budget is exhausted.
            const failure = result.validation_failure;
            const downgraded: NarrativeSegment = {
              type: 'prose',
              text:
                failure.failed_text.length > 0
                  ? failure.failed_text
                  : `[downgraded ${failure.section_kind}#${failure.segment_index}: ${failure.reason}]`,
            };
            const k = keyOf(failure.section_kind, failure.segment_index);
            if (!state.yielded_keys.has(k)) {
              state.yielded_keys.add(k);
              const buf = state.segmentsBySection.get(failure.section_kind) ?? [];
              buf.push(downgraded);
              state.segmentsBySection.set(failure.section_kind, buf);
            }
            state.validation_downgraded_count += 1;
            out.push({
              type: 'segment',
              section_kind: failure.section_kind,
              segment_index: failure.segment_index,
              segment: downgraded,
            });
            break;
          }

          // Push correction into conversation and re-stream.
          conversation = [
            ...conversation,
            { role: 'assistant', content: result.assistant_blocks },
            { role: 'user', content: correctionUserMessage(result.validation_failure) },
          ];
          correction_retries += 1;
        }

        // Lifecycle events.
        for (const sectionKind of input.target_section_kinds) {
          const segs = state.segmentsBySection.get(sectionKind) ?? [];
          const claim_count = segs.filter((s) => s.type === 'claim').length;
          out.push({
            type: 'section_complete',
            section_kind: sectionKind,
            segment_count: segs.length,
            claim_count,
          });
        }
        const total_segments = [...state.segmentsBySection.values()].reduce(
          (n, s) => n + s.length,
          0,
        );
        out.push({
          type: 'done',
          total_segments,
          total_claims: state.total_claims,
          validation_downgraded_count: state.validation_downgraded_count,
          tokens_in: total_tokens_in,
          tokens_out: total_tokens_out,
          model,
          prompt_version: promptKey,
        });

        // Record final tokens on the span so cost_usd derives correctly.
        setAttr({ tokens_in: total_tokens_in, tokens_out: total_tokens_out });

        return { events: out };
      },
    );
  } catch (err) {
    const classification = classifyError(err, input.abortSignal);
    yield {
      type: 'error',
      reason: classification.reason,
      retryable: classification.retryable,
    };
    return;
  }

  for (const ev of runOutcome.events) {
    yield ev;
  }
}
