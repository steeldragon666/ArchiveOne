import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { sql } from '@cpa/db/client';
import { sessionPlugin } from './session.js';
import { signSession } from './jwt.js';

const TEST_SECRET = 'test-secret-32-bytes-of-entropy!!';

interface WhoamiResponse {
  authenticated: boolean;
  user?: {
    id: string;
    email: string;
    tenantId: string | null;
    role: 'admin' | 'consultant' | 'viewer' | null;
  };
}

const buildApp = async () => {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(sessionPlugin, { secret: TEST_SECRET, cookieName: 'cpa_session' });
  app.get('/test/whoami', (req): WhoamiResponse => {
    if (!req.user) return { authenticated: false };
    return { authenticated: true, user: req.user };
  });
  return app;
};

after(async () => {
  await sql.end();
});

test('session: anonymous request — no req.user, route runs, returns 200', async () => {
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/test/whoami' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { authenticated: false });
  await app.close();
});

test('session: valid cookie — req.user populated correctly', async () => {
  const app = await buildApp();
  const jwt = await signSession(
    {
      sub: '00000000-0000-4000-8000-000000000071',
      email: 'session-test@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: '00000000-0000-4000-8000-0000000000a7',
      activeRole: 'consultant',
      availableTenants: [],
    },
    TEST_SECRET,
    { ttlSeconds: 3600 },
  );
  const res = await app.inject({
    method: 'GET',
    url: '/test/whoami',
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json<WhoamiResponse>();
  assert.equal(body.authenticated, true);
  assert.equal(body.user?.id, '00000000-0000-4000-8000-000000000071');
  assert.equal(body.user?.email, 'session-test@example.com');
  assert.equal(body.user?.tenantId, '00000000-0000-4000-8000-0000000000a7');
  assert.equal(body.user?.role, 'consultant');
  await app.close();
});

test('session: expired cookie — 401 + cookie cleared', async () => {
  const app = await buildApp();
  const jwt = await signSession(
    {
      sub: '00000000-0000-4000-8000-000000000071',
      email: 'x@x',
      primaryIdp: 'microsoft',
      activeTenantId: null,
      activeRole: null,
      availableTenants: [],
    },
    TEST_SECRET,
    { ttlSeconds: -1 },
  );
  const res = await app.inject({
    method: 'GET',
    url: '/test/whoami',
    cookies: { cpa_session: jwt },
  });
  assert.equal(res.statusCode, 401);
  const setCookie = res.headers['set-cookie'];
  const setCookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
  assert.match(setCookieStr, /cpa_session=;.*Max-Age=0/i);
  await app.close();
});

test('session: tampered cookie — 401', async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/test/whoami',
    cookies: { cpa_session: 'not.a.valid.jwt' },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});
