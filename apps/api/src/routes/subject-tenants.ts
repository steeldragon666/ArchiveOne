import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { listSubjectTenantsQuery, type SubjectTenant } from '@cpa/schemas';

interface RawSubjectTenantRow {
  id: string;
  tenant_id: string;
  name: string;
  kind: 'claimant' | 'financier';
  created_at: Date | string;
  updated_at: Date | string;
}

const isoOf = (v: Date | string): string => (typeof v === 'string' ? v : v.toISOString());

const toApi = (r: RawSubjectTenantRow): SubjectTenant => ({
  id: r.id,
  tenant_id: r.tenant_id,
  name: r.name,
  kind: r.kind,
  created_at: isoOf(r.created_at),
  updated_at: isoOf(r.updated_at),
});

/**
 * Register the subject-tenant routes (list / create / detail / chain-status).
 *
 * Auth: requireSession (any tenant_user with an active firm). Admin/consultant
 * gating happens per-route where mutations are involved (create).
 *
 * RLS: every query runs inside `sql.begin` with `set_config('app.current_tenant_id',
 * tenantId, true)` so the SELECTs are tenant-scoped. We don't rely on the
 * session middleware's `set_config` because postgres-js connection pooling
 * makes session-scoped GUCs unreliable across pool checkouts.
 */
export function registerSubjectTenants(app: FastifyInstance): void {
  app.get('/v1/subject-tenants', { preHandler: requireSession }, async (req, reply) => {
    const parsed = listSubjectTenantsQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_query',
        message: 'Query must match { kind?: "claimant" | "financier" }',
        requestId: req.id,
      });
    }
    const { kind } = parsed.data;
    const tenantId = req.user!.tenantId!;

    return await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

      const rows = kind
        ? await tx<RawSubjectTenantRow[]>`
            SELECT id, tenant_id, name, kind, created_at, updated_at
              FROM subject_tenant
             WHERE kind = ${kind}
               AND deleted_at IS NULL
             ORDER BY created_at ASC
          `
        : await tx<RawSubjectTenantRow[]>`
            SELECT id, tenant_id, name, kind, created_at, updated_at
              FROM subject_tenant
             WHERE deleted_at IS NULL
             ORDER BY created_at ASC
          `;

      return { subject_tenants: rows.map(toApi) };
    });
  });
}
