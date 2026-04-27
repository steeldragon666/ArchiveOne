import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  apiFetch,
} from './api.js';

const mockFetch = (status: number, body: unknown): typeof fetch => {
  return (): Promise<Response> =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response);
};

test('apiFetch: 200 returns parsed JSON', async () => {
  globalThis.fetch = mockFetch(200, { ok: true });
  const r = await apiFetch<{ ok: boolean }>('/v1/healthz');
  assert.deepEqual(r, { ok: true });
});

test('apiFetch: 204 returns undefined (no JSON parse attempt)', async () => {
  globalThis.fetch = mockFetch(204, null);
  const r = await apiFetch<void>('/v1/auth/signout', { method: 'POST' });
  assert.equal(r, undefined);
});

test('apiFetch: 401 throws UnauthenticatedError', async () => {
  globalThis.fetch = mockFetch(401, { error: 'unauthenticated', message: 'No session' });
  await assert.rejects(
    () => apiFetch('/v1/whoami'),
    (err: unknown) => err instanceof UnauthenticatedError && err.status === 401,
  );
});

test('apiFetch: 403 throws ForbiddenError', async () => {
  globalThis.fetch = mockFetch(403, { error: 'forbidden', message: 'Admin role required' });
  await assert.rejects(() => apiFetch('/v1/users'), ForbiddenError);
});

test('apiFetch: 404 throws NotFoundError', async () => {
  globalThis.fetch = mockFetch(404, { error: 'user_not_found', message: 'User not found' });
  await assert.rejects(() => apiFetch('/v1/users/abc'), NotFoundError);
});

test('apiFetch: 409 throws ConflictError', async () => {
  globalThis.fetch = mockFetch(409, { error: 'last_admin', message: 'Cannot demote' });
  await assert.rejects(() => apiFetch('/v1/users/abc', { method: 'DELETE' }), ConflictError);
});

test('apiFetch: 500 throws generic ApiError', async () => {
  globalThis.fetch = mockFetch(500, { error: 'internal', message: 'Boom' });
  await assert.rejects(
    () => apiFetch('/v1/whoami'),
    (err: unknown) => err instanceof ApiError && err.status === 500,
  );
});

test('apiFetch: non-JSON error body falls back gracefully', async () => {
  const failingFetch: typeof fetch = (): Promise<Response> =>
    Promise.resolve({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('not json')),
    } as unknown as Response);
  globalThis.fetch = failingFetch;
  await assert.rejects(
    () => apiFetch('/v1/whoami'),
    (err: unknown) => err instanceof ApiError && err.status === 502,
  );
});
