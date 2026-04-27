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
 * Register GET /v1/users — list users in the caller's active firm.
 *
 * Joins user × tenant_user, RLS-scoped to the active tenant via the
 * sessionPlugin's app.current_tenant_id GUC. We additionally wrap in
 * sql.begin() with SET LOCAL to guarantee the GUC applies to the same
 * connection that runs the SELECT (postgres-js pooling makes the
 * session-scoped GUC unreliable across connection reuse).
 *
 * preHandler: requireAdmin (firm membership management is admin-only).
 *
 * Returns: UserRef[] in addedAt-ascending order (oldest members first).
 *
 * Soft-deleted memberships are filtered out by default. Pass
 * ?includeDeleted=true to include them (admin tooling for firms doing
 * audit reviews).
 */
export function registerListUsers(app: FastifyInstance): void {
  app.get('/v1/users', { preHandler: requireAdmin }, async (req) => {
    const includeDeleted =
      typeof (req.query as Record<string, unknown>)['includeDeleted'] === 'string' &&
      ((req.query as Record<string, unknown>)['includeDeleted'] as string).toLowerCase() === 'true';
    const tenantId = req.user!.tenantId!;

    return await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

      const rows = includeDeleted
        ? await tx<RawUserRow[]>`
            SELECT u.id, u.email, u.display_name, tu.role, tu.is_default, tu.created_at AS added_at
              FROM tenant_user tu
              JOIN "user" u ON u.id = tu.user_id
             ORDER BY tu.created_at ASC
          `
        : await tx<RawUserRow[]>`
            SELECT u.id, u.email, u.display_name, tu.role, tu.is_default, tu.created_at AS added_at
              FROM tenant_user tu
              JOIN "user" u ON u.id = tu.user_id
             WHERE tu.deleted_at IS NULL AND u.deleted_at IS NULL
             ORDER BY tu.created_at ASC
          `;

      return {
        users: rows.map((r) => ({
          id: r.id,
          email: r.email,
          displayName: r.display_name,
          role: r.role,
          isDefault: r.is_default,
          addedAt: typeof r.added_at === 'string' ? r.added_at : r.added_at.toISOString(),
        })),
      };
    });
  });
}
