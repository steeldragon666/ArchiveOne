/**
 * Streaming orchestrator tests for Agent C (narrative drafter).
 *
 * Mocking strategy: rather than nock-ing Anthropic's SSE wire format
 * (fragile, couples tests to SDK internals), we inject a stub client
 * via `_setStreamingClientForTests` whose `messages.stream(...)`
 * returns a hand-crafted async-iterable of `MessageStreamEvent`s. The
 * orchestrator only consumes the stream via async iteration, so this
 * structural stand-in is sufficient.
 *
 * Each turn the model takes is one stream invocation; a multi-turn
 * test (correction loop) hands the stub a queue of pre-built turns so
 * successive `messages.stream(...)` calls drain the queue in order.
 */

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { trace } from '@opentelemetry/api';
import type { Tracer, Span, SpanContext, AttributeValue, SpanStatus } from '@opentelemetry/api';
import {
  streamNarrativeDraft,
  _setStreamingClientForTests,
  type CompressedEvent,
  type StreamEvent,
  type StreamNarrativeDraftInput,
} from './stream.js';
import type { SectionKind } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Recording tracer (mirrors telemetry.test.ts pattern) so we can assert that
// the orchestrator emitted token attributes on its span.
// ─────────────────────────────────────────────────────────────────────────────

type Recorded = {
  name: string;
  attrs: Record<string, AttributeValue>;
  status: SpanStatus | null;
};
const allSpans: Recorded[] = [];
function makeRecordingTracer(): Tracer {
  function makeSpan(name: string): Span {
    const recorded: Recorded = { name, attrs: {}, status: null };
    allSpans.push(recorded);
    const span: Span = {
      spanContext(): SpanContext {
        return { traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 0 };
      },
      setAttribute(key: string, value: AttributeValue): Span {
        recorded.attrs[key] = value;
        return span;
      },
      setAttributes(attrs): Span {
        for (const [k, v] of Object.entries(attrs)) {
          if (v !== undefined) recorded.attrs[k] = v;
        }
        return span;
      },
      addEvent(): Span {
        return span;
      },
      addLink(): Span {
        return span;
      },
      addLinks(): Span {
        return span;
      },
      setStatus(status): Span {
        recorded.status = status;
        return span;
      },
      updateName(): Span {
        return span;
      },
      end(): void {},
      isRecording(): boolean {
        return true;
      },
      recordException(): void {},
    };
    return span;
  }
  return {
    startSpan(name: string): Span {
      return makeSpan(name);
    },
    startActiveSpan(name: string, arg2: unknown, arg3?: unknown, arg4?: unknown): unknown {
      const fn =
        typeof arg2 === 'function'
          ? (arg2 as (span: Span) => unknown)
          : typeof arg3 === 'function'
            ? (arg3 as (span: Span) => unknown)
            : (arg4 as (span: Span) => unknown);
      return fn(makeSpan(name));
    },
  };
}
trace.setGlobalTracerProvider({ getTracer: () => makeRecordingTracer() });

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const PROJ_ID = '00000000-0000-4000-8000-000000000001';
const ACT_ID = '00000000-0000-4000-8000-000000000002';
const EV_A = '11111111-1111-4111-8111-111111111111';
const EV_B = '22222222-2222-4222-8222-222222222222';
const EV_C = '33333333-3333-4333-8333-333333333333';

function clusteredEvent(id: string, kind = 'OBSERVATION', summary = 'evt'): CompressedEvent {
  return { id, kind, captured_at: '2025-01-01T00:00:00Z', summary };
}

function baseInput(overrides: Partial<StreamNarrativeDraftInput> = {}): StreamNarrativeDraftInput {
  const ac = new AbortController();
  return {
    activity: {
      id: ACT_ID,
      name: 'Test activity',
      kind: 'core',
      statutory_anchor: 's.355-25',
      project_id: PROJ_ID,
    },
    project: {
      id: PROJ_ID,
      name: 'Test project',
      industry_sector: 'Software',
      fiscal_year: 2025,
    },
    clustered_events: [clusteredEvent(EV_A), clusteredEvent(EV_B), clusteredEvent(EV_C)],
    prefill: null,
    existing_sections: null,
    target_section_kinds: ['new_knowledge'],
    abortSignal: ac.signal,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stub Anthropic streaming events
// ─────────────────────────────────────────────────────────────────────────────

type SegmentEmit = {
  section_kind: SectionKind;
  segment_index: number;
} & ({ type: 'prose'; text: string } | { type: 'claim'; text: string; citing_events: string[] });

let nextToolUseId = 1;

/**
 * Build a sequence of `MessageStreamEvent`s representing one assistant
 * turn that emits the supplied segments via `emit_segment` tool calls.
 * Each segment becomes one tool_use block; partial-json deltas are
 * stitched as a single delta per block (we don't need to test partial
 * accumulation, only end-to-end correctness once a block stops).
 */
function buildTurnEvents(
  segments: SegmentEmit[],
  usage = { input: 100, output: 200 },
): Anthropic.MessageStreamEvent[] {
  const events: Anthropic.MessageStreamEvent[] = [];
  events.push({
    type: 'message_start',
    message: {
      id: `msg_${String(nextToolUseId++)}`,
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-sonnet-4-5',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: usage.input, output_tokens: 0 },
    },
  });

  segments.forEach((seg, i) => {
    const id = `tu_${String(nextToolUseId++)}`;
    events.push({
      type: 'content_block_start',
      index: i,
      content_block: { type: 'tool_use', id, name: 'emit_segment', input: {} },
    });
    events.push({
      type: 'content_block_delta',
      index: i,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(seg) },
    });
    events.push({ type: 'content_block_stop', index: i });
  });

  events.push({
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: usage.output },
  });
  events.push({ type: 'message_stop' });
  return events;
}

/**
 * Wrap a series of pre-baked turns into a stub `StreamingClientLike`.
 * Each call to `messages.stream(...)` drains one turn; the optional
 * `onTurn` callback fires before iteration so the test can assert on
 * conversation state or simulate aborts.
 */
function makeStubClient(
  turns: Array<
    Anthropic.MessageStreamEvent[] | (() => AsyncIterable<Anthropic.MessageStreamEvent>)
  >,
): {
  messages: {
    stream: (
      params: Anthropic.MessageStreamParams,
      options?: { signal?: AbortSignal },
    ) => AsyncIterable<Anthropic.MessageStreamEvent>;
  };
  callsMade: Anthropic.MessageStreamParams[];
} {
  const callsMade: Anthropic.MessageStreamParams[] = [];
  let cursor = 0;
  return {
    callsMade,
    messages: {
      stream(params, _options) {
        callsMade.push(params);
        const turn = turns[cursor++];
        if (!turn) {
          throw new Error(`stub ran out of turns (called ${cursor} times)`);
        }
        if (typeof turn === 'function') {
          return turn();
        }
        const events = turn;
        return {
          async *[Symbol.asyncIterator]() {
            await Promise.resolve();
            for (const ev of events) yield ev;
          },
        };
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test setup
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  nextToolUseId = 1;
  _setStreamingClientForTests(null);
});

after(() => {
  _setStreamingClientForTests(null);
});

async function collect(input: StreamNarrativeDraftInput): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of streamNarrativeDraft(input)) {
    out.push(ev);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test('happy path: 3 valid segments → 3 segment + 1 section_complete + 1 done', async () => {
  const stub = makeStubClient([
    buildTurnEvents([
      {
        section_kind: 'new_knowledge',
        segment_index: 0,
        type: 'prose',
        text: 'Under s.355-25(1)(a)…',
      },
      {
        section_kind: 'new_knowledge',
        segment_index: 1,
        type: 'claim',
        text: 'Public literature documents convergence at 5–10M timesteps.',
        citing_events: [EV_A],
      },
      {
        section_kind: 'new_knowledge',
        segment_index: 2,
        type: 'claim',
        text: 'Preliminary scoping confirmed convergence gap.',
        citing_events: [EV_B, EV_C],
      },
    ]),
  ]);
  _setStreamingClientForTests(stub);

  const events = await collect(baseInput());

  const segments = events.filter((e) => e.type === 'segment');
  assert.equal(segments.length, 3);
  assert.equal(segments[0]?.type === 'segment' && segments[0].segment.type, 'prose');
  assert.equal(segments[1]?.type === 'segment' && segments[1].segment.type, 'claim');

  const sectionComplete = events.find((e) => e.type === 'section_complete');
  assert.ok(sectionComplete && sectionComplete.type === 'section_complete');
  assert.equal(sectionComplete.section_kind, 'new_knowledge');
  assert.equal(sectionComplete.segment_count, 3);
  assert.equal(sectionComplete.claim_count, 2);

  const done = events.find((e) => e.type === 'done');
  assert.ok(done && done.type === 'done');
  assert.equal(done.total_segments, 3);
  assert.equal(done.total_claims, 2);
  assert.equal(done.validation_downgraded_count, 0);
  assert.equal(done.tokens_in, 100);
  assert.equal(done.tokens_out, 200);
  assert.equal(done.model, 'claude-sonnet-4-5');
  assert.equal(done.prompt_version, 'draft-narrative@1.0.0');

  // Exactly one error event would be a regression — should be zero.
  assert.equal(events.filter((e) => e.type === 'error').length, 0);
});

test('correction loop fires once and succeeds: claim with empty citing_events → re-emit with citation', async () => {
  // Turn 1: model emits a "claim" segment whose wire-format passes
  // (citing_events has length ≥ 1) but the cited event is OUTSIDE the
  // clustered set — `validateSegment` rejects, correction fires.
  // Turn 2: model re-emits the same segment_index with a valid id.
  const OUT_OF_CLUSTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const stub = makeStubClient([
    buildTurnEvents([
      {
        section_kind: 'new_knowledge',
        segment_index: 0,
        type: 'claim',
        text: 'A bad claim.',
        citing_events: [OUT_OF_CLUSTER],
      },
    ]),
    buildTurnEvents([
      {
        section_kind: 'new_knowledge',
        segment_index: 0,
        type: 'claim',
        text: 'A bad claim.',
        citing_events: [EV_A],
      },
    ]),
  ]);
  _setStreamingClientForTests(stub);

  const events = await collect(baseInput());

  const segments = events.filter((e) => e.type === 'segment');
  assert.equal(segments.length, 1);
  assert.equal(stub.callsMade.length, 2);
  // Second call should include the correction in its conversation.
  const lastConv = stub.callsMade[1]?.messages ?? [];
  assert.ok(lastConv.length >= 3, 'correction call should have user + assistant + user');
  const lastUser = lastConv[lastConv.length - 1];
  assert.equal(lastUser?.role, 'user');
  const userContent = typeof lastUser?.content === 'string' ? lastUser.content : '';
  assert.match(userContent, /failed validation/);

  const done = events.find((e) => e.type === 'done');
  assert.ok(done && done.type === 'done');
  assert.equal(done.validation_downgraded_count, 0);
});

test('correction loop exhausted: 3 invalid claim segments → downgrade to prose, count = 1', async () => {
  // Each turn the model emits a claim with an out-of-cluster citation.
  // After MAX_CORRECTION_RETRIES (= 2) corrections we should downgrade
  // the failed segment to prose and emit it.
  const OUT_OF_CLUSTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const badSeg: SegmentEmit = {
    section_kind: 'new_knowledge',
    segment_index: 0,
    type: 'claim',
    text: 'Persistently bad claim.',
    citing_events: [OUT_OF_CLUSTER],
  };
  const stub = makeStubClient([
    buildTurnEvents([badSeg]),
    buildTurnEvents([badSeg]),
    buildTurnEvents([badSeg]),
  ]);
  _setStreamingClientForTests(stub);

  const events = await collect(baseInput());

  // Expect: 1 segment (the downgraded prose), 1 section_complete, 1 done.
  const segments = events.filter((e) => e.type === 'segment');
  assert.equal(segments.length, 1);
  const downgraded = segments[0];
  assert.ok(downgraded && downgraded.type === 'segment');
  assert.equal(downgraded.segment.type, 'prose');
  assert.equal(downgraded.segment.text, 'Persistently bad claim.');

  const done = events.find((e) => e.type === 'done');
  assert.ok(done && done.type === 'done');
  assert.equal(done.validation_downgraded_count, 1);
  assert.equal(done.total_segments, 1);
  assert.equal(done.total_claims, 0);

  // Stub must have been called exactly MAX_CORRECTION_RETRIES + 1 = 3 times.
  assert.equal(stub.callsMade.length, 3);
});

test('Anthropic 5xx mid-stream → error event, retryable: true, no done', async () => {
  // Turn yields message_start then throws a 5xx-shaped error.
  const stub: Parameters<typeof _setStreamingClientForTests>[0] = {
    messages: {
      stream() {
        return {
          async *[Symbol.asyncIterator]() {
            await Promise.resolve();
            yield {
              type: 'message_start',
              message: {
                id: 'msg_x',
                type: 'message',
                role: 'assistant',
                content: [],
                model: 'claude-sonnet-4-5',
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 0 },
              },
            } satisfies Anthropic.MessageStreamEvent;
            const err: Error & { status?: number } = new Error('upstream 502');
            err.status = 502;
            throw err;
          },
        };
      },
    },
  };
  _setStreamingClientForTests(stub);

  const events = await collect(baseInput());

  const errorEv = events.find((e) => e.type === 'error');
  assert.ok(errorEv && errorEv.type === 'error');
  assert.equal(errorEv.reason, 'anthropic_5xx');
  assert.equal(errorEv.retryable, true);
  // Crucially: NO done event after error.
  assert.equal(events.filter((e) => e.type === 'done').length, 0);
});

test('abort mid-stream: caller aborts after first segment → error: aborted, retryable: false', async () => {
  const ac = new AbortController();
  const stub: Parameters<typeof _setStreamingClientForTests>[0] = {
    messages: {
      stream() {
        return {
          async *[Symbol.asyncIterator]() {
            await Promise.resolve();
            yield {
              type: 'message_start',
              message: {
                id: 'msg_a',
                type: 'message',
                role: 'assistant',
                content: [],
                model: 'claude-sonnet-4-5',
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 0 },
              },
            } satisfies Anthropic.MessageStreamEvent;
            yield {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'tool_use',
                id: 'tu_a',
                name: 'emit_segment',
                input: {},
              },
            };
            yield {
              type: 'content_block_delta',
              index: 0,
              delta: {
                type: 'input_json_delta',
                partial_json: JSON.stringify({
                  section_kind: 'new_knowledge',
                  segment_index: 0,
                  type: 'prose',
                  text: 'first',
                }),
              },
            };
            yield { type: 'content_block_stop', index: 0 };
            // Caller aborts here.
            ac.abort();
            // Mimic the SDK's behaviour: when the signal is aborted
            // mid-iteration, throw an AbortError on the next yield.
            const e = new Error('Aborted');
            e.name = 'AbortError';
            throw e;
          },
        };
      },
    },
  };
  _setStreamingClientForTests(stub);

  const events = await collect(baseInput({ abortSignal: ac.signal }));

  const errorEv = events.find((e) => e.type === 'error');
  assert.ok(errorEv && errorEv.type === 'error');
  assert.equal(errorEv.reason, 'aborted');
  assert.equal(errorEv.retryable, false);
  assert.equal(events.filter((e) => e.type === 'done').length, 0);
});

test('no segments emitted: stop_reason end_turn with zero tool_use blocks → done with totals = 0', async () => {
  const stub = makeStubClient([
    [
      {
        type: 'message_start',
        message: {
          id: 'msg_e',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-5',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 50, output_tokens: 0 },
        },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 5 },
      },
      { type: 'message_stop' },
    ],
  ]);
  _setStreamingClientForTests(stub);

  const events = await collect(baseInput());
  const done = events.find((e) => e.type === 'done');
  assert.ok(done && done.type === 'done');
  assert.equal(done.total_segments, 0);
  assert.equal(done.total_claims, 0);
  assert.equal(done.validation_downgraded_count, 0);
  assert.equal(events.filter((e) => e.type === 'segment').length, 0);
});

test('citing_events outside clustered_events: validator rejects → correction fires → re-emit succeeds', async () => {
  const OUT_OF_CLUSTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const stub = makeStubClient([
    buildTurnEvents([
      {
        section_kind: 'new_knowledge',
        segment_index: 0,
        type: 'claim',
        text: 'Cites foreign event.',
        citing_events: [OUT_OF_CLUSTER],
      },
    ]),
    buildTurnEvents([
      {
        section_kind: 'new_knowledge',
        segment_index: 0,
        type: 'claim',
        text: 'Cites foreign event.',
        citing_events: [EV_B],
      },
    ]),
  ]);
  _setStreamingClientForTests(stub);

  const events = await collect(baseInput());
  const segments = events.filter((e) => e.type === 'segment');
  assert.equal(segments.length, 1);
  const seg = segments[0];
  assert.ok(seg && seg.type === 'segment' && seg.segment.type === 'claim');
  assert.deepEqual(seg.segment.citing_events, [EV_B]);

  // Correction prompt mentions the rejected event id (or at minimum,
  // mentions failed validation with the section/index).
  const lastConv = stub.callsMade[1]?.messages ?? [];
  const lastUser = lastConv[lastConv.length - 1];
  const text = typeof lastUser?.content === 'string' ? lastUser.content : '';
  assert.match(text, /new_knowledge/);
  assert.match(text, /failed validation/);
});

test('telemetry span emitted with cpa.tokens_in / cpa.tokens_out', async () => {
  const beforeCount = allSpans.length;
  const stub = makeStubClient([
    buildTurnEvents(
      [
        {
          section_kind: 'new_knowledge',
          segment_index: 0,
          type: 'prose',
          text: 'Hello.',
        },
      ],
      { input: 333, output: 444 },
    ),
  ]);
  _setStreamingClientForTests(stub);
  await collect(baseInput());

  // Find the most-recent narrative-drafter span.
  const span = [...allSpans].reverse().find((s) => s.name === 'narrative-drafter');
  assert.ok(span, 'narrative-drafter span should be recorded');
  assert.equal(span.attrs['cpa.agent_name'], 'narrative-drafter');
  assert.equal(span.attrs['cpa.prompt_version'], 'draft-narrative@1.0.0');
  assert.equal(span.attrs['cpa.model'], 'claude-sonnet-4-5');
  assert.equal(span.attrs['cpa.tokens_in'], 333);
  assert.equal(span.attrs['cpa.tokens_out'], 444);
  assert.ok(typeof span.attrs['cpa.cost_usd'] === 'number');
  assert.ok(allSpans.length > beforeCount);
});
