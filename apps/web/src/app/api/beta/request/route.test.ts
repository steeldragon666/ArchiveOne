import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock @cpa/email's send before importing the route.
let sentEmails: Array<{ to: string; subject: string }> = [];
// @ts-expect-error - we monkey-patch the module before route imports it.
globalThis.__test_send = (input: { to: string; subject: string }) => {
  sentEmails.push(input);
  return Promise.resolve();
};

const TEST_SECRET = 'a'.repeat(64);
process.env.BETA_AUTH_SECRET = TEST_SECRET;
process.env.BETA_ALLOWLIST = 'alice@firm.com';
process.env.BETA_FROM_ADDRESS = 'Test <test@test.io>';

const { POST } = await import('./route.js');

beforeEach(() => {
  sentEmails = [];
});

function makeReq(body: unknown, ip = '127.0.0.1'): Request {
  return new Request('https://example.com/api/beta/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

test('POST /api/beta/request: allowlisted email -> 200 + email sent', async () => {
  const res = await POST(makeReq({ email: 'alice@firm.com' }));
  assert.equal(res.status, 200);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0]!.to, 'alice@firm.com');
});

test('POST /api/beta/request: NON-allowlisted email -> 200 + no email sent (no enumeration)', async () => {
  const res = await POST(makeReq({ email: 'evil@attacker.com' }));
  assert.equal(res.status, 200);
  assert.equal(sentEmails.length, 0);
});

test('POST /api/beta/request: case-insensitive allowlist match', async () => {
  const res = await POST(makeReq({ email: 'ALICE@firm.COM' }));
  assert.equal(res.status, 200);
  assert.equal(sentEmails.length, 1);
});

test('POST /api/beta/request: malformed email -> 400', async () => {
  const res = await POST(makeReq({ email: 'not-an-email' }));
  assert.equal(res.status, 400);
  assert.equal(sentEmails.length, 0);
});

test('POST /api/beta/request: 6th request from same IP in 1 hr -> 429', async () => {
  for (let i = 0; i < 5; i += 1) {
    const r = await POST(makeReq({ email: 'alice@firm.com' }, '10.0.0.42'));
    assert.equal(r.status, 200);
  }
  const sixth = await POST(makeReq({ email: 'alice@firm.com' }, '10.0.0.42'));
  assert.equal(sixth.status, 429);
  assert.ok(sixth.headers.get('retry-after'));
});
