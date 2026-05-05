import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContractTestRunner } from './contract-test-runner.js';

test('contract-test-runner: buildContractTestRunner returns a function', () => {
  const runner = buildContractTestRunner({ repoRoot: '/tmp/fake' });
  assert.equal(typeof runner, 'function');
});
