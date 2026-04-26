import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '@cpa/auth';
import { sql } from '@cpa/db/client';

/**
 * Register DELETE /v1/users/:userId — soft-delete a firm membership.
 *
 * Sets tenant_user.deleted_at = NOW(). The user's underlying user row
 * is untouched (they may belong to other firms). Re-adding them later
 * via POST /v1/users will un-soft-delete via getOrAddTenantUser's
 * 'undeleted' branch.
 *
 * Last-admin guard: refuses to remove the firm's only admin (409).
 *
 * preHandler: requireAdmin.
 */
export function registerRemoveUser(app: FastifyInstance): void {
  app.delete<{ Params: { userId: string } }>(
    '/v1/users/:userId',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { userId } = req.params;
      const tenantId = req.user!.tenantId!;

      return await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        const current = await tx<
          {
            id: string;
            role: 'admin' | 'consultant' | 'viewer';
          }[]
        >`
          SELECT id, role FROM tenant_user
           WHERE user_id = ${userId} AND deleted_at IS NULL
           FOR UPDATE
        `;
        if (!current[0]) {
          return reply.status(404).send({
            error: 'user_not_found',
            message: 'No active membership for that user in this firm',
            requestId: req.id,
          });
        }

        if (current[0].role === 'admin') {
          const adminCount = await tx<{ n: string }[]>`
            SELECT COUNT(*)::text AS n FROM tenant_user
             WHERE role = 'admin' AND deleted_at IS NULL
          `;
          if (adminCount[0]?.n === '1') {
            return reply.status(409).send({
              error: 'last_admin',
              message: 'Cannot remove the only firm admin. Promote another user first.',
              requestId: req.id,
            });
          }
        }

        await tx`
          UPDATE tenant_user SET deleted_at = NOW() WHERE id = ${current[0].id}
        `;
        return reply.status(204).send();
      });
    },
  );
}
