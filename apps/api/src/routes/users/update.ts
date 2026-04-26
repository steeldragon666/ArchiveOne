import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '@cpa/auth';
import { sql } from '@cpa/db/client';

const UpdateBody = z
  .object({
    role: z.enum(['admin', 'consultant', 'viewer']).optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((b) => b.role !== undefined || b.isDefault !== undefined, {
    message: 'Body must include at least one of role or isDefault',
  });

interface RawTenantUserRow {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'consultant' | 'viewer';
  is_default: boolean;
  added_at: Date | string;
}

/**
 * Register PATCH /v1/users/:userId — change role and/or is_default.
 *
 * Body: { role?, isDefault? } — at least one required.
 *
 * Last-admin guard: if the request would demote the firm's last admin
 * (role !== 'admin' OR removing admin role from the only admin), 409.
 * The check counts active admins inside the same transaction so a
 * concurrent demote-then-promote can't race past it.
 *
 * preHandler: requireAdmin.
 */
export function registerUpdateUser(app: FastifyInstance): void {
  app.patch<{ Params: { userId: string } }>(
    '/v1/users/:userId',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = UpdateBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: parsed.error.issues[0]?.message ?? 'Body invalid',
          requestId: req.id,
        });
      }
      const { role, isDefault } = parsed.data;
      const { userId } = req.params;
      const tenantId = req.user!.tenantId!;

      return await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        // Fetch current row (RLS-scoped). 404 if no active membership.
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

        // Last-admin guard: if currently admin and role is being changed
        // to non-admin, count active admins. If only one (this row),
        // refuse.
        if (current[0].role === 'admin' && role !== undefined && role !== 'admin') {
          const adminCount = await tx<{ n: string }[]>`
            SELECT COUNT(*)::text AS n FROM tenant_user
             WHERE role = 'admin' AND deleted_at IS NULL
          `;
          if (adminCount[0]?.n === '1') {
            return reply.status(409).send({
              error: 'last_admin',
              message: 'Cannot demote the only firm admin. Promote another user first.',
              requestId: req.id,
            });
          }
        }

        // Build the UPDATE — only fields provided in body get updated.
        const updated = await tx<RawTenantUserRow[]>`
          UPDATE tenant_user
             SET role = COALESCE(${role ?? null}, role),
                 is_default = COALESCE(${isDefault ?? null}, is_default)
           WHERE id = ${current[0].id}
          RETURNING id,
                    user_id,
                    role,
                    is_default,
                    created_at AS added_at,
                    (SELECT email FROM "user" WHERE id = tenant_user.user_id) AS email,
                    (SELECT display_name FROM "user" WHERE id = tenant_user.user_id) AS display_name
        `;
        const r = updated[0];
        if (!r) {
          throw new Error('updateUser: UPDATE returned no row');
        }
        return {
          id: r.user_id,
          email: r.email,
          displayName: r.display_name,
          role: r.role,
          isDefault: r.is_default,
          addedAt: typeof r.added_at === 'string' ? r.added_at : r.added_at.toISOString(),
        };
      });
    },
  );
}
