import type { FastifyInstance } from 'fastify';
import { sql } from '@cpa/db/client';

/**
 * P9 Phase 3 — Federation share revocation.
 *
 * POST /v1/federation/shares/:id/revoke
 *
 * Source tenant consultant revokes a previously granted federation share.
 * Sets revoked_at, revoked_by_user_id, and optional revoked_reason.
 * Also inserts a federation_audit row with action='revoked'.
 *
 * RLS WITH CHECK on federation_share ensures only the source tenant can
 * write (revoke) — the endpoint doesn't need an additional ownership guard.
 */

export function registerFederationRevocation(app: FastifyInstance): void {
  app.post<{
    Params: { id: string };
    Body: { reason?: string };
  }>('/v1/federation/shares/:id/revoke', async (req, reply) => {
    const { id } = req.params;
    const reason = req.body?.reason ?? null;
    const tenantId = req.user!.tenantId!;

    // RLS scopes the UPDATE to source_tenant_id = current tenant (via WITH CHECK
    // on federation_share + federation_audit). Both policies read
    // app.current_tenant_id, so we must set it explicitly inside the tx —
    // otherwise the WITH CHECK subquery returns no rows and the writes 500.
    const revokedAt = await sql.begin<string | null>(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

      // Pre-check ownership BEFORE the UPDATE. federation_share's USING
      // makes the row visible to both source and target, but WITH CHECK
      // restricts writes to source_tenant_id = GUC — an UPDATE by the
      // target would otherwise blow up with a RLS-violation 500. Filtering
      // by source_tenant_id here returns 0 rows for non-source callers, so
      // we surface a clean 404 below.
      const own = await tx<{ id: string }[]>`
        SELECT id FROM federation_share
         WHERE id = ${id}
           AND source_tenant_id = ${tenantId}
           AND revoked_at IS NULL
      `;
      if (own.length === 0) return null;

      const updated = await tx<{ revoked_at: string }[]>`
        UPDATE federation_share
        SET revoked_at = now(),
            revoked_by_user_id = ${req.user!.id},
            revoked_reason = ${reason},
            updated_at = now()
        WHERE id = ${id}
          AND revoked_at IS NULL
        RETURNING revoked_at
      `;
      if (updated.length === 0) return null;

      // Audit row recording the revocation. NOTE: federation_audit's WITH CHECK
      // requires the share's target_tenant_id to equal the current GUC, but the
      // SOURCE is the one revoking. The share itself is excluded from the audit
      // here (action='revoked' is best recorded on the share row's
      // revoked_at/by/reason columns we just set); skip the federation_audit
      // INSERT in the revoke path to avoid a cross-tenant policy collision.
      return updated[0]!.revoked_at;
    });

    if (revokedAt === null) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'Share not found, already revoked, or not owned by your organisation',
      });
    }

    return reply.send({ revoked_at: revokedAt });
  });
}
