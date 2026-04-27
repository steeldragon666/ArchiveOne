import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
// Side-effect import — @fastify/cookie augments FastifyRequest with `cookies`.
// We don't register it here (the host app does), but TypeScript needs the
// declaration merge at compile time.
import '@fastify/cookie';
import { sql } from '@cpa/db/client';
import { verifySession, type VerifiedSession } from './jwt.js';

export interface SessionPluginOptions {
  secret: string;
  cookieName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      tenantId: string | null;
      role: 'admin' | 'consultant' | 'viewer' | null;
    };
  }
}

const clearSessionCookie = (reply: FastifyReply, name: string): void => {
  void reply.header('set-cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
};

const sessionImpl = (app: FastifyInstance, opts: SessionPluginOptions): Promise<void> => {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const cookieValue = req.cookies[opts.cookieName];
    if (!cookieValue) {
      // Anonymous request — req.user stays undefined; routes that need
      // auth check req.user themselves and 401 if missing.
      return;
    }

    let claims: VerifiedSession;
    try {
      claims = await verifySession(cookieValue, opts.secret);
    } catch {
      clearSessionCookie(reply, opts.cookieName);
      void reply
        .status(401)
        .send({ error: 'invalid_session', message: 'Session invalid or expired' });
      return reply;
    }

    req.user = {
      id: claims.sub,
      email: claims.email,
      tenantId: claims.activeTenantId,
      role: claims.activeRole,
    };

    // Set the connection's app.current_tenant_id GUC so subsequent SQL
    // queries from this request are RLS-scoped. Session-scoped (is_local
    // = false) — the onResponse hook below resets it before the
    // connection returns to the pool. Migration 0003 wraps current_setting
    // in NULLIF so empty-string ('') correctly resolves to NULL → policy
    // excludes rows (correct fail-safe).
    if (claims.activeTenantId !== null) {
      await sql`SELECT set_config('app.current_tenant_id', ${claims.activeTenantId}, false)`;
    }
  });

  app.addHook('onResponse', async () => {
    // Connection-state hygiene: clear the GUC so a subsequent request that
    // doesn't set it sees the fail-safe NULL/'' behavior.
    await sql`SELECT set_config('app.current_tenant_id', '', false)`;
  });

  return Promise.resolve();
};

export const sessionPlugin = fp(sessionImpl, {
  name: 'cpa-session',
  fastify: '5.x',
});
