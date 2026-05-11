/**
 * P7 Theme D Task D.13 Phase 5C — Error classifier tests.
 *
 * Validates that 403 (bot-blocked) and 404 (url-stale) errors are
 * classified distinctly from each other and from transient 5xx errors.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from './error-classifier.js';

describe('classifyError', () => {
  describe('rate_limited', () => {
    test('classifies HTTP 429 message', () => {
      assert.equal(classifyError(new Error('HTTP 429 from source')), 'rate_limited');
    });

    test('classifies explicit rate limit message', () => {
      assert.equal(classifyError(new Error('rate limit exceeded')), 'rate_limited');
    });

    test('classifies [rate-limited] prefix from rifFetch', () => {
      assert.equal(
        classifyError(new Error('[rate-limited] HTTP 429 from https://example.com')),
        'rate_limited',
      );
    });

    test('classifies too many requests', () => {
      assert.equal(classifyError(new Error('too many requests')), 'rate_limited');
    });
  });

  describe('network_error (bot-blocked)', () => {
    test('classifies [bot-blocked] prefix from rifFetch as network_error', () => {
      assert.equal(
        classifyError(new Error('[bot-blocked] HTTP 403 from https://www.ato.gov.au')),
        'network_error',
      );
    });

    test('classifies bare HTTP 403 message as network_error', () => {
      assert.equal(classifyError(new Error('HTTP 403 from source')), 'network_error');
    });

    test('classifies ECONNREFUSED as network_error', () => {
      assert.equal(classifyError(new Error('ECONNREFUSED 127.0.0.1:443')), 'network_error');
    });

    test('classifies ETIMEDOUT as network_error', () => {
      assert.equal(classifyError(new Error('ETIMEDOUT')), 'network_error');
    });

    test('classifies fetch failed as network_error', () => {
      assert.equal(classifyError(new Error('fetch failed: network error')), 'network_error');
    });

    test('classifies 5xx exhaustion as network_error', () => {
      assert.equal(
        classifyError(new Error('HTTP 500 from https://example.com on attempt 3/3')),
        'network_error',
      );
    });
  });

  describe('parse_error (url-stale / parse failure)', () => {
    test('classifies [url-stale] prefix from rifFetch as parse_error', () => {
      assert.equal(
        classifyError(new Error('[url-stale] HTTP 404 from https://www.industry.gov.au')),
        'parse_error',
      );
    });

    test('classifies bare HTTP 404 message as parse_error', () => {
      assert.equal(classifyError(new Error('HTTP 404 from source')), 'parse_error');
    });

    test('classifies parse failure as parse_error', () => {
      assert.equal(classifyError(new Error('parse error: unexpected end of input')), 'parse_error');
    });

    test('classifies malformed XML as parse_error', () => {
      assert.equal(classifyError(new Error('malformed XML document')), 'parse_error');
    });

    test('classifies invalid JSON as parse_error', () => {
      assert.equal(classifyError(new Error('invalid json at position 0')), 'parse_error');
    });
  });

  describe('default fallback', () => {
    test('returns network_error for unknown Error', () => {
      assert.equal(classifyError(new Error('something went wrong')), 'network_error');
    });

    test('returns network_error for non-Error thrown value', () => {
      assert.equal(classifyError('a string error'), 'network_error');
    });

    test('returns network_error for null', () => {
      assert.equal(classifyError(null), 'network_error');
    });

    test('distinguishes 403 from 404 — bot-blocked is network_error, url-stale is parse_error', () => {
      const botBlocked = classifyError(
        new Error('[bot-blocked] HTTP 403 from https://example.com'),
      );
      const urlStale = classifyError(new Error('[url-stale] HTTP 404 from https://example.com'));
      assert.equal(botBlocked, 'network_error');
      assert.equal(urlStale, 'parse_error');
      assert.notEqual(botBlocked, urlStale);
    });
  });
});
