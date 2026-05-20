import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import nock from 'nock';
import { z } from 'zod';
import { _resetAnthropicClientForTests, getAnthropicClient } from './anthropic-client.js';
import { callWithToolUse } from './tool-use.js';

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  _resetAnthropicClientForTests();
  nock.cleanAll();
});

after(() => {
  nock.cleanAll();
});

test('callWithToolUse extracts tool_use block and returns parsed output', async () => {
  const schema = z.object({ kind: z.string(), confidence: z.number() });

  nock('https://api.anthropic.com')
    .post('/v1/messages')
    .reply(200, {
      id: 'msg_x',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'classify',
          input: { kind: 'HYPOTHESIS', confidence: 0.85 },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    });

  const r = await callWithToolUse(getAnthropicClient(), {
    model: 'claude-haiku-4-5',
    system: 'sys',
    user: 'classify this',
    tool: { name: 'classify', description: 'd', input_schema: schema },
  });
  assert.equal(r.output.kind, 'HYPOTHESIS');
  assert.equal(r.output.confidence, 0.85);
  assert.equal(r.tokens_in, 100);
  assert.equal(r.tokens_out, 50);
});

test('callWithToolUse handles ZodDiscriminatedUnion (oneOf with const discriminators)', async () => {
  // Real-world shape from emitPortalFieldsToolSchema: discriminated union
  // on `activity_kind`. Each branch is a strict object so the JSON schema
  // sent to Anthropic has additionalProperties: false at the top level.
  const schema = z.discriminatedUnion('activity_kind', [
    z.object({ activity_kind: z.literal('core'), fields: z.object({ name: z.string() }) }).strict(),
    z
      .object({ activity_kind: z.literal('supporting'), fields: z.object({ name: z.string() }) })
      .strict(),
  ]);

  // Intercept the request so we can assert the JSON Schema sent.
  let receivedInputSchema: unknown = null;
  nock('https://api.anthropic.com')
    .post('/v1/messages', (body: { tools?: Array<{ input_schema?: unknown }> }) => {
      receivedInputSchema = body.tools?.[0]?.input_schema ?? null;
      return true;
    })
    .reply(200, {
      id: 'msg_y',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content: [
        {
          type: 'tool_use',
          id: 'tu_2',
          name: 'emit',
          input: { activity_kind: 'core', fields: { name: 'x' } },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });

  const r = await callWithToolUse(getAnthropicClient(), {
    model: 'claude-haiku-4-5',
    system: 's',
    user: 'u',
    tool: { name: 'emit', description: 'd', input_schema: schema },
  });

  // Parsed output reaches caller.
  assert.equal(r.output.activity_kind, 'core');

  // Anthropic rejects `oneOf` at any level of input_schema, so the converter
  // flattens unions-of-objects: discriminator becomes an enum on the merged
  // root, branch-specific fields are merged (marked optional), shared fields
  // de-duplicated, additionalProperties: false preserved when every branch
  // is strict. Zod re-validates the discriminated invariants post-call.
  const sent = receivedInputSchema as {
    type?: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
    additionalProperties?: boolean;
    oneOf?: unknown;
  } | null;
  assert.ok(sent !== null, 'tool input_schema must be present in request');
  assert.equal(sent.type, 'object', 'flattened root must have type=object');
  assert.equal(
    sent.oneOf,
    undefined,
    'flattened root must NOT include oneOf (Anthropic rejects it)',
  );
  assert.equal(
    sent.additionalProperties,
    false,
    '.strict() on every branch propagates to merged root',
  );
  // Discriminator key rendered as enum
  const disc = sent.properties?.['activity_kind'] as { type?: string; enum?: string[] } | undefined;
  assert.equal(disc?.type, 'string');
  assert.deepEqual(disc?.enum, ['core', 'supporting']);
  // Shared key `fields` present (last-wins shape)
  assert.ok(sent.properties?.['fields'], 'shared `fields` key must be in merged properties');
  // Both keys are required in every branch → required on merged root
  assert.deepEqual([...(sent.required ?? [])].sort(), ['activity_kind', 'fields']);
});

test('callWithToolUse throws when no tool_use block returned', async () => {
  const schema = z.object({ kind: z.string() });
  nock('https://api.anthropic.com')
    .post('/v1/messages')
    .reply(200, {
      id: 'm',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content: [{ type: 'text', text: 'I refused to use the tool' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  await assert.rejects(
    callWithToolUse(getAnthropicClient(), {
      model: 'claude-haiku-4-5',
      system: 's',
      user: 'u',
      tool: { name: 'classify', description: 'd', input_schema: schema },
    }),
    /did not invoke the structured-output tool/,
  );
});
