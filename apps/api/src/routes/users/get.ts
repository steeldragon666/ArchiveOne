import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '@cpa/auth';
import { sql } from '@cpa/db/client';

interface RawUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'consultant' | 'viewer';
  is_default: boolean;
  added_at: Date | string;
}

/**
 * Register GET /v1/users/:userId — return one user's membership in the
 * active firm.
 *
 * 404 if no row exists for (active_tenant, userId), or if the row is
 * soft-deleted (use the list endpoint with ?includeDeleted=true to see
 * removed members).
 *
 * preHandler: requireAdmin.
 */
export function registerGetUser(app: FastifyInstance): void {
  app.get<{ Params: { userId: string } }>(
    '/v1/users/:userId',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { userId } = req.params;
      const tenantId = req.user!.tenantId!;

      return await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        const rows = await tx<RawUserRow[]>`
          SELECT u.id, u.email, u.display_name, tu.role, tu.is_default, tu.created_at AS added_at
            FROM tenant_user tu
            JOIN "user" u ON u.id = tu.user_id
           WHERE tu.user_id = ${userId}
             AND tu.deleted_at IS NULL
             AND u.deleted_at IS NULL
        `;

        if (!rows[0]) {
          return reply.status(404).send({
            error: 'user_not_found',
            message: 'No active member with that user_id in this firm',
            requestId: req.id,
          });
        }

        return {
          id: rows[0].id,
          email: rows[0].email,
          displayName: rows[0].display_name,
          role: rows[0].role,
          isDefault: rows[0].is_default,
          addedAt:
            typeof rows[0].added_at === 'string'
              ? rows[0].added_at
              : rows[0].added_at.toISOString(),
        };
      });
    },
  );
}
