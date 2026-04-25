import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from './logger.js';

test('createLogger returns a logger with the configured name and default info level', () => {
  const logger = createLogger({ serviceName: 'test-svc' });
  assert.equal(logger.level, 'info');
  // pino sets `name` via bindings — accessible via logger.bindings()
  assert.equal(logger.bindings().name, 'test-svc');
});

test('createLogger respects an explicit level override', () => {
  const logger = createLogger({ serviceName: 'test-svc', level: 'debug' });
  assert.equal(logger.level, 'debug');
});

test('createLogger respects LOG_LEVEL env var', () => {
  const original = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'warn';
  try {
    const logger = createLogger({ serviceName: 'test-svc' });
    assert.equal(logger.level, 'warn');
  } finally {
    if (original === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = original;
    }
  }
});
