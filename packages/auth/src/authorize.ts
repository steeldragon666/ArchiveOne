import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * preHandler that gates access to authenticated routes:
 *
 * - 401 if no session (req.user undefined — sessionPlugin didn't populate)
 * - 403 if session has no active tenant (user has zero tenant_user rows;
 *   sessionPlugin populated req.user with tenantId === null)
 *
 * Routes attach via:
 *   app.get('/v1/example', { preHandler: requireSession }, handler)
 *
 * Most identity-routes need this. Use requireAdmin for the strictly-admin
 * surface (firm management).
 */
export async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user) {
    await reply
      .status(401)
      .send({ error: 'unauthenticated', message: 'No session', requestId: req.id });
    return;
  }
  if (req.user.tenantId === null) {
    await reply.status(403).send({
      error: 'no_active_tenant',
      message: 'No active firm — contact your firm admin to be added',
      requestId: req.id,
    });
    return;
  }
}

/**
 * preHandler that gates access to admin-only routes:
 *
 * - 401 if no session
 * - 403 if session role !== 'admin'
 *
 * Note: doesn't itself enforce tenantId !== null because role === 'admin'
 * already implies tenantId is set (the role comes from a tenant_user row).
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.user) {
    await reply
      .status(401)
      .send({ error: 'unauthenticated', message: 'No session', requestId: req.id });
    return;
  }
  if (req.user.role !== 'admin') {
    await reply.status(403).send({
      error: 'forbidden',
      message: 'Admin role required',
      requestId: req.id,
    });
    return;
  }
}
