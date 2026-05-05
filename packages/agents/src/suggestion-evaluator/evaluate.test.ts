import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluate,
  EvaluatorConfigError,
  EvaluatorUpstreamError,
  EvaluatorParseError,
  EvaluatorLoopExhaustedError,
} from './evaluate.js';

test('evaluate.ts: exports the expected public API', () => {
  assert.equal(typeof evaluate, 'function');
  assert.equal(typeof EvaluatorConfigError, 'function');
  assert.equal(typeof EvaluatorUpstreamError, 'function');
  assert.equal(typeof EvaluatorParseError, 'function');
  assert.equal(typeof EvaluatorLoopExhaustedError, 'function');
});
