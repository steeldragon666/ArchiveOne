import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { makeExpenditureClassifier } from './factory.js';
import { HaikuExpenditureClassifier } from './haiku.js';
import { StubExpenditureClassifier } from './stub.js';

const ENV_KEYS = ['EXPENDITURE_CLASSIFIER_IMPL', 'CI', 'ANTHROPIC_API_KEY'] as const;
let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test('EXPENDITURE_CLASSIFIER_IMPL=stub → StubExpenditureClassifier', () => {
  process.env.EXPENDITURE_CLASSIFIER_IMPL = 'stub';
  assert.ok(makeExpenditureClassifier() instanceof StubExpenditureClassifier);
});

test('EXPENDITURE_CLASSIFIER_IMPL=haiku → HaikuExpenditureClassifier', () => {
  process.env.EXPENDITURE_CLASSIFIER_IMPL = 'haiku';
  assert.ok(makeExpenditureClassifier() instanceof HaikuExpenditureClassifier);
});

test('CI=true and unset EXPENDITURE_CLASSIFIER_IMPL → StubExpenditureClassifier', () => {
  process.env.CI = 'true';
  assert.ok(makeExpenditureClassifier() instanceof StubExpenditureClassifier);
});

test('CI unset and EXPENDITURE_CLASSIFIER_IMPL unset → HaikuExpenditureClassifier', () => {
  assert.ok(makeExpenditureClassifier() instanceof HaikuExpenditureClassifier);
});

test('explicit EXPENDITURE_CLASSIFIER_IMPL=haiku overrides CI=true', () => {
  process.env.CI = 'true';
  process.env.EXPENDITURE_CLASSIFIER_IMPL = 'haiku';
  assert.ok(makeExpenditureClassifier() instanceof HaikuExpenditureClassifier);
});

test('unknown EXPENDITURE_CLASSIFIER_IMPL throws', () => {
  process.env.EXPENDITURE_CLASSIFIER_IMPL = 'nonsense';
  assert.throws(() => makeExpenditureClassifier(), /unknown EXPENDITURE_CLASSIFIER_IMPL/);
});

test('EXPENDITURE_CLASSIFIER_IMPL is independent of CLASSIFIER_IMPL', () => {
  // Setting the evidence-classifier env var must not influence the
  // expenditure-classifier resolution.
  process.env.CLASSIFIER_IMPL = 'stub';
  // EXPENDITURE_CLASSIFIER_IMPL unset, no CI → defaults to haiku.
  assert.ok(makeExpenditureClassifier() instanceof HaikuExpenditureClassifier);
  delete process.env.CLASSIFIER_IMPL;
});
