/**
 * P7 Theme D Task D.13 Phase 5C — rifFetch resilience tests.
 *
 * Tests retry/backoff, error prefix semantics, and Retry-After header
 * handling without making real network calls.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rifFetch, RIF_USER_AGENT } from './fetch-with-retry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    text: () => Promise.resolve('body'),
  } as unknown as Response;
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe('rifFetch success', () => {
  test('returns response on 200', async () => {
    globalThis.fetch = () => Promise.resolve(makeMockResponse(200));
    const res = await rifFetch('https://example.com/feed');
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
  });

  test('sends correct User-Agent header', async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = (_url, init) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return Promise.resolve(makeMockResponse(200));
    };

    await rifFetch('https://example.com/feed');
    assert.equal(capturedHeaders['User-Agent'], RIF_USER_AGENT);
  });

  test('caller Accept header overrides default', async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = (_url, init) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return Promise.resolve(makeMockResponse(200));
    };

    await rifFetch('https://example.com/feed', {
      headers: { Accept: 'application/rss+xml, */*' },
    });
    assert.equal(capturedHeaders['Accept'], 'application/rss+xml, */*');
    // User-Agent must still be set
    assert.equal(capturedHeaders['User-Agent'], RIF_USER_AGENT);
  });
});

// ---------------------------------------------------------------------------
// 4xx — not retried, distinct error messages
// ---------------------------------------------------------------------------

describe('rifFetch 4xx errors', () => {
  test('throws [bot-blocked] on 403', async () => {
    globalThis.fetch = () => Promise.resolve(makeMockResponse(403));
    await assert.rejects(
      () => rifFetch('https://example.com'),
      (err: Error) => {
        assert.ok(err.message.includes('[bot-blocked]'), `got: ${err.message}`);
        assert.ok(err.message.includes('403'), `got: ${err.message}`);
        return true;
      },
    );
  });

  test('throws [url-stale] on 404', async () => {
    globalThis.fetch = () => Promise.resolve(makeMockResponse(404));
    await assert.rejects(
      () => rifFetch('https://example.com'),
      (err: Error) => {
        assert.ok(err.message.includes('[url-stale]'), `got: ${err.message}`);
        assert.ok(err.message.includes('404'), `got: ${err.message}`);
        return true;
      },
    );
  });

  test('403 and 404 errors have distinct prefixes', async () => {
    globalThis.fetch = () => Promise.resolve(makeMockResponse(403));
    let msg403 = '';
    try {
      await rifFetch('https://example.com');
    } catch (e) {
      msg403 = (e as Error).message;
    }

    globalThis.fetch = () => Promise.resolve(makeMockResponse(404));
    let msg404 = '';
    try {
      await rifFetch('https://example.com');
    } catch (e) {
      msg404 = (e as Error).message;
    }

    assert.ok(msg403.startsWith('[bot-blocked]'), `403 prefix wrong: ${msg403}`);
    assert.ok(msg404.startsWith('[url-stale]'), `404 prefix wrong: ${msg404}`);
    assert.notEqual(msg403, msg404);
  });

  test('does not retry on 403 (only 1 fetch call)', async () => {
    let calls = 0;
    globalThis.fetch = () => {
      calls++;
      return Promise.resolve(makeMockResponse(403));
    };
    await assert.rejects(() => rifFetch('https://example.com'));
    assert.equal(calls, 1);
  });

  test('does not retry on 404 (only 1 fetch call)', async () => {
    let calls = 0;
    globalThis.fetch = () => {
      calls++;
      return Promise.resolve(makeMockResponse(404));
    };
    await assert.rejects(() => rifFetch('https://example.com'));
    assert.equal(calls, 1);
  });
});

// ---------------------------------------------------------------------------
// 5xx — retried with backoff (up to 3 attempts)
// ---------------------------------------------------------------------------

describe('rifFetch 5xx retry', () => {
  test('retries on 500 and succeeds on second attempt', async () => {
    // Speed up by stubbing setTimeout to fire immediately
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((cb: () => void) =>
      realSetTimeout(cb, 0)) as typeof globalThis.setTimeout;

    let calls = 0;
    globalThis.fetch = () => {
      calls++;
      return Promise.resolve(makeMockResponse(calls < 2 ? 500 : 200));
    };

    try {
      const res = await rifFetch('https://example.com');
      assert.equal(res.status, 200);
      assert.equal(calls, 2);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  test('throws after 3 failed 500 attempts', async () => {
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((cb: () => void) =>
      realSetTimeout(cb, 0)) as typeof globalThis.setTimeout;

    let calls = 0;
    globalThis.fetch = () => {
      calls++;
      return Promise.resolve(makeMockResponse(500));
    };

    try {
      await assert.rejects(() => rifFetch('https://example.com'), /HTTP 500/);
      assert.equal(calls, 3);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});

// ---------------------------------------------------------------------------
// 429 — rate limited, honours Retry-After
// ---------------------------------------------------------------------------

describe('rifFetch 429 Retry-After', () => {
  test('throws [rate-limited] after exhausting retries on 429', async () => {
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((cb: () => void) =>
      realSetTimeout(cb, 0)) as typeof globalThis.setTimeout;

    globalThis.fetch = () => Promise.resolve(makeMockResponse(429, { 'retry-after': '1' }));

    try {
      await assert.rejects(
        () => rifFetch('https://example.com'),
        (err: Error) => {
          assert.ok(err.message.includes('[rate-limited]'), `got: ${err.message}`);
          return true;
        },
      );
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  test('reads integer Retry-After header and waits that many seconds', async () => {
    const realSetTimeout = globalThis.setTimeout;
    const capturedDelays: number[] = [];
    globalThis.setTimeout = ((cb: () => void, ms?: number) => {
      capturedDelays.push(ms ?? 0);
      return realSetTimeout(cb, 0);
    }) as typeof globalThis.setTimeout;

    let calls = 0;
    globalThis.fetch = () => {
      calls++;
      return Promise.resolve(
        calls < 3 ? makeMockResponse(429, { 'retry-after': '5' }) : makeMockResponse(200),
      );
    };

    try {
      const res = await rifFetch('https://example.com');
      assert.equal(res.status, 200);
      // Two 429s → two Retry-After waits of 5s each = 5000ms each
      assert.ok(
        capturedDelays.some((d) => d === 5000),
        `Expected 5000ms delay, got: ${JSON.stringify(capturedDelays)}`,
      );
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});
