import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SYSTEM_PROMPT, classifyExpenditureToolSchema } from './classify-expenditure@1.0.0.js';
import { getPrompt, listPrompts } from '../../runtime/prompt-registry.js';

const VALID_UUID_A = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_B = '22222222-2222-4222-8222-222222222222';

const validEligible = {
  expenditure_id: VALID_UUID_A,
  decision: 'eligible' as const,
  eligibility_probability: 0.88,
  statutory_anchor: 's.355-25' as const,
  suggested_activity_id: VALID_UUID_B,
  rationale: 'Lab reagents consumed in systematic experimentation under §355-25(1)(a).',
  uncertainty_reason: null,
};

test('classify-expenditure@1.0.0 is registered in the prompt registry', () => {
  const keys = listPrompts();
  assert.ok(
    keys.includes('classify-expenditure@1.0.0'),
    `expected listPrompts() to include 'classify-expenditure@1.0.0', got ${JSON.stringify(keys)}`,
  );
  const p = getPrompt('classify-expenditure@1.0.0');
  assert.equal(p.name, 'classify-expenditure');
  assert.equal(p.version, '1.0.0');
  assert.equal(p.tool.name, 'classify_expenditure');
  assert.equal(typeof p.tool.description, 'string');
  assert.ok(p.tool.description.length > 0);
  assert.equal(p.system, SYSTEM_PROMPT);
});

test('system prompt cites Division 355 anchors', () => {
  // Defense-in-depth: catch refactors that strip the statutory anchors.
  assert.match(SYSTEM_PROMPT, /§355-25/);
  assert.match(SYSTEM_PROMPT, /§355-30/);
  assert.match(SYSTEM_PROMPT, /classify_expenditure/);
});

test('tool schema parses a valid eligible classification', () => {
  const parsed = classifyExpenditureToolSchema.parse(validEligible);
  assert.equal(parsed.decision, 'eligible');
  assert.equal(parsed.statutory_anchor, 's.355-25');
  assert.equal(parsed.suggested_activity_id, VALID_UUID_B);
  assert.equal(parsed.uncertainty_reason, null);
});

test('tool schema accepts decision="needs_review" with non-null uncertainty_reason', () => {
  const parsed = classifyExpenditureToolSchema.parse({
    ...validEligible,
    decision: 'needs_review',
    eligibility_probability: 0.55,
    suggested_activity_id: null,
    uncertainty_reason:
      'AWS spend on a shared account — cannot separate experimental compute from production hosting.',
  });
  assert.equal(parsed.decision, 'needs_review');
  assert.equal(parsed.suggested_activity_id, null);
  assert.equal(typeof parsed.uncertainty_reason, 'string');
});

test('tool schema accepts ineligible with suggested_activity_id=null', () => {
  const parsed = classifyExpenditureToolSchema.parse({
    ...validEligible,
    decision: 'ineligible',
    statutory_anchor: 'ineligible',
    suggested_activity_id: null,
    eligibility_probability: 0.94,
  });
  assert.equal(parsed.decision, 'ineligible');
  assert.equal(parsed.statutory_anchor, 'ineligible');
  assert.equal(parsed.suggested_activity_id, null);
});

test('tool schema rejects an unknown decision string', () => {
  const result = classifyExpenditureToolSchema.safeParse({
    ...validEligible,
    decision: 'maybe',
  });
  assert.equal(result.success, false);
});

test('tool schema rejects eligibility_probability outside [0,1]', () => {
  for (const bad of [-0.01, 1.01, 2, -5]) {
    const result = classifyExpenditureToolSchema.safeParse({
      ...validEligible,
      eligibility_probability: bad,
    });
    assert.equal(result.success, false, `expected ${bad} to be rejected`);
  }
});

test('tool schema rejects an invalid UUID in expenditure_id', () => {
  const result = classifyExpenditureToolSchema.safeParse({
    ...validEligible,
    expenditure_id: 'not-a-uuid',
  });
  assert.equal(result.success, false);
});

test('tool schema rejects an invalid UUID in suggested_activity_id when non-null', () => {
  const result = classifyExpenditureToolSchema.safeParse({
    ...validEligible,
    suggested_activity_id: 'not-a-uuid',
  });
  assert.equal(result.success, false);
});

test('tool schema rejects a statutory_anchor outside the enum', () => {
  const result = classifyExpenditureToolSchema.safeParse({
    ...validEligible,
    statutory_anchor: 's.355-99',
  });
  assert.equal(result.success, false);
});

test('tool schema rejects an empty rationale', () => {
  const result = classifyExpenditureToolSchema.safeParse({
    ...validEligible,
    rationale: '',
  });
  assert.equal(result.success, false);
});

test('tool schema rejects a rationale longer than 800 chars', () => {
  const result = classifyExpenditureToolSchema.safeParse({
    ...validEligible,
    rationale: 'a'.repeat(801),
  });
  assert.equal(result.success, false);
});

test('tool schema does not include runtime-injected metadata fields', () => {
  // Defense-in-depth: the runtime stamps `_v`, `model`, `prompt_version`,
  // and `idempotency_key` after the model returns. The TOOL schema must
  // NOT advertise them — otherwise the model could fabricate them.
  // Zod by default strips unknown keys, so we assert the SHAPE excludes them.
  const shape = (
    classifyExpenditureToolSchema as unknown as {
      shape: Record<string, unknown>;
    }
  ).shape;
  for (const forbidden of ['_v', 'model', 'prompt_version', 'idempotency_key']) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(shape, forbidden),
      false,
      `tool schema must not declare ${forbidden} (runtime-injected)`,
    );
  }
  // And the parsed output must not surface them even if the model sends them.
  const parsed = classifyExpenditureToolSchema.parse({
    ...validEligible,
    _v: 1,
    model: 'claude-haiku-x',
    prompt_version: '1.0.0',
    idempotency_key: 'k',
  });
  assert.equal('_v' in parsed, false);
  assert.equal('model' in parsed, false);
  assert.equal('prompt_version' in parsed, false);
  assert.equal('idempotency_key' in parsed, false);
});
