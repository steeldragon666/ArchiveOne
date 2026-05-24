import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import nock from 'nock';

import { OpusExpenditureClassifier } from './opus.js';
import { _resetAnthropicClientForTests } from '../runtime/anthropic-client.js';
import type { ExpenditureClassifierInput } from './types.js';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const ACTIVITY_UUID = '22222222-2222-4222-8222-222222222222';

function makeInput(
  overrides: Partial<{ expenditure_id: string }> = {},
): ExpenditureClassifierInput {
  return {
    expenditure_id: overrides.expenditure_id ?? VALID_UUID,
    expenditure: {
      vendor_name: 'Sigma-Aldrich',
      description: 'Reagents for hypothesis-test batch experiments',
      total_amount: '3420.00',
      currency: 'AUD',
      expenditure_date: '2025-07-01',
      source: 'xero_invoice',
      kind: 'INVOICE',
    },
    project: {
      name: 'Catalyst Longevity Study',
      industry_sector: 'biotech',
      fiscal_year: 2026,
    },
    existing_activities: [],
    recent_evidence_events: [],
  };
}

const SAVED_MODEL_ENV = process.env.EXPENDITURE_CLASSIFIER_MODEL;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.EXPENDITURE_CLASSIFIER_MODEL;
  _resetAnthropicClientForTests();
  nock.cleanAll();
});

afterEach(() => {
  if (SAVED_MODEL_ENV === undefined) delete process.env.EXPENDITURE_CLASSIFIER_MODEL;
  else process.env.EXPENDITURE_CLASSIFIER_MODEL = SAVED_MODEL_ENV;
});

after(() => {
  nock.cleanAll();
});

test('OpusExpenditureClassifier round-trips through Anthropic SDK', async () => {
  nock('https://api.anthropic.com')
    .post('/v1/messages')
    .reply(200, {
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-7',
      content: [
        {
          type: 'tool_use',
          id: 't',
          name: 'classify_expenditure',
          input: {
            expenditure_id: VALID_UUID,
            decision: 'eligible',
            eligibility_probability: 0.88,
            statutory_anchor: 's.355-25',
            suggested_activity_id: ACTIVITY_UUID,
            rationale: 'Lab reagents consumed in systematic experimentation under §355-25(1)(a).',
            uncertainty_reason: null,
          },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 420, output_tokens: 90 },
    });

  const c = new OpusExpenditureClassifier();
  const out = await c.classify(makeInput());

  assert.equal(out.expenditure_id, VALID_UUID);
  assert.equal(out.decision, 'eligible');
  assert.equal(out.eligibility_probability, 0.88);
  assert.equal(out.statutory_anchor, 's.355-25');
  assert.equal(out.suggested_activity_id, ACTIVITY_UUID);
  assert.equal(out.uncertainty_reason, null);
  assert.equal(out.model, 'claude-opus-4-7');
  assert.equal(out.prompt_version, 'classify-expenditure@1.0.0');
  assert.equal(out.tokens_in, 420);
  assert.equal(out.tokens_out, 90);
});

test('mismatched expenditure_id throws (model corruption guard)', async () => {
  nock('https://api.anthropic.com')
    .post('/v1/messages')
    .reply(200, {
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-7',
      content: [
        {
          type: 'tool_use',
          id: 't',
          name: 'classify_expenditure',
          input: {
            // Different from the input UUID:
            expenditure_id: '33333333-3333-4333-8333-333333333333',
            decision: 'eligible',
            eligibility_probability: 0.88,
            statutory_anchor: 's.355-25',
            suggested_activity_id: null,
            rationale: 'Some rationale.',
            uncertainty_reason: null,
          },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 30 },
    });

  const c = new OpusExpenditureClassifier();
  await assert.rejects(() => c.classify(makeInput()), /classifier echoed wrong expenditure_id/);
});

test('EXPENDITURE_CLASSIFIER_MODEL env override is respected', async () => {
  process.env.EXPENDITURE_CLASSIFIER_MODEL = 'claude-opus-4-7-experimental';
  let capturedBody: unknown = null;
  nock('https://api.anthropic.com')
    .post('/v1/messages', (body: unknown) => {
      capturedBody = body;
      return true;
    })
    .reply(200, {
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-7-experimental',
      content: [
        {
          type: 'tool_use',
          id: 't',
          name: 'classify_expenditure',
          input: {
            expenditure_id: VALID_UUID,
            decision: 'ineligible',
            eligibility_probability: 0.94,
            statutory_anchor: 'ineligible',
            suggested_activity_id: null,
            rationale: 'Commodity SaaS.',
            uncertainty_reason: null,
          },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 50, output_tokens: 20 },
    });

  const c = new OpusExpenditureClassifier();
  const out = await c.classify(makeInput());

  assert.equal(out.model, 'claude-opus-4-7-experimental');
  assert.equal((capturedBody as { model: string }).model, 'claude-opus-4-7-experimental');
});

test('the user message carries the serialised input bundle', async () => {
  type CapturedBody = { messages: Array<{ role: string; content: string }> };
  let capturedBody: CapturedBody | null = null;
  nock('https://api.anthropic.com')
    .post('/v1/messages', (body: unknown) => {
      capturedBody = body as CapturedBody;
      return true;
    })
    .reply(200, {
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-7',
      content: [
        {
          type: 'tool_use',
          id: 't',
          name: 'classify_expenditure',
          input: {
            expenditure_id: VALID_UUID,
            decision: 'eligible',
            eligibility_probability: 0.88,
            statutory_anchor: 's.355-25',
            suggested_activity_id: null,
            rationale: 'r',
            uncertainty_reason: null,
          },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });

  const c = new OpusExpenditureClassifier();
  await c.classify(makeInput());

  assert.ok(capturedBody, 'expected to capture the request body');
  const body: CapturedBody = capturedBody;
  const userContent = body.messages[0]?.content;
  assert.equal(typeof userContent, 'string');
  // The user message must be valid JSON containing the expenditure_id.
  const parsed = JSON.parse(userContent ?? '') as {
    expenditure_id: string;
    expenditure: { vendor_name: string };
  };
  assert.equal(parsed.expenditure_id, VALID_UUID);
  assert.equal(parsed.expenditure.vendor_name, 'Sigma-Aldrich');
});
