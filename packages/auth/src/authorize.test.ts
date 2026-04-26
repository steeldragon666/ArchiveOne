import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { requireAdmin, requireSession } from './authorize.js';

const buildApp = (
  setUser?: { id: string; email: string; tenantId: string | null; role: 'admin' | 'consultant' | 'viewer' | null },
  preHandler: 'session' | 'admin' = 'session',
) => {
  const app = Fastify({ logger: false });
  if (setUser) {
    app.addHook('onRequest', (req, _reply, done) => {
      req.user = setUser;
      done();
    });
  }
  const hook = preHandler === 'session' ? requireSession : requireAdmin;
  app.get('/x', { preHandler: hook }, async () => ({ ok: true }));
  return app;
};

test('requireSession: 401 when req.user is undefined', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/x' });
  assert.equal(res.statusCode, 401);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'unauthenticated');
  await app.close();
});

test('requireSession: 403 when req.user has tenantId=null', async () => {
  const app = buildApp({ id: 'u1', email: 'u1@example.com', tenantId: null, role: null });
  const res = await app.inject({ method: 'GET', url: '/x' });
  assert.equal(res.statusCode, 403);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'no_active_tenant');
  await app.close();
});

test('requireSession: passes when req.user has active tenant', async () => {
  const app = buildApp({ id: 'u1', email: 'u1@example.com', tenantId: 't1', role: 'consultant' });
  const res = await app.inject({ method: 'GET', url: '/x' });
  assert.equal(res.statusCode, 200);
  const body = res.json<{ ok: boolean }>();
  assert.equal(body.ok, true);
  await app.close();
});

test('requireAdmin: 401 when req.user is undefined', async () => {
  const app = buildApp(undefined, 'admin');
  const res = await app.inject({ method: 'GET', url: '/x' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('requireAdmin: 403 when role !== admin', async () => {
  const app = buildApp(
    { id: 'u1', email: 'u1@example.com', tenantId: 't1', role: 'consultant' },
    'admin',
  );
  const res = await app.inject({ method: 'GET', url: '/x' });
  assert.equal(res.statusCode, 403);
  const body = res.json<{ error: string }>();
  assert.equal(body.error, 'forbidden');
  await app.close();
});

test('requireAdmin: passes when role === admin', async () => {
  const app = buildApp(
    { id: 'u1', email: 'u1@example.com', tenantId: 't1', role: 'admin' },
    'admin',
  );
  const res = await app.inject({ method: 'GET', url: '/x' });
  assert.equal(res.statusCode, 200);
  await app.close();
});
