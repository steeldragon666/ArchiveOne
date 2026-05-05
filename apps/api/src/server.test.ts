import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.js';

test('buildApp accepts production deps shape (smoke wiring test)', async () => {
  const app = buildApp({
    promptSuggestions: {
      evaluate: () => Promise.resolve({} as never),
      choreograph: () => Promise.resolve({} as never),
      runContractTest: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    },
  });
  await app.ready();
  // Hitting an unknown route should return 404 (proves app booted)
  const res = await app.inject({ method: 'GET', url: '/__nope__' });
  assert.equal(res.statusCode, 404);
  await app.close();
});
