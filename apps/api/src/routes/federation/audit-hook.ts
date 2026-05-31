import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { insertEventWithChain } from '@cpa/db';
import { sql } from '@cpa/db/client';

/**
 * P9 Phase 3 — Federation audit hook.
 *
 * Fastify `onResponse` hook registered on federation read routes.
 * After a successful federated read response:
 *   1. INSERT into federation_audit (share_id, user_id, resource_type, resource_id)
 *   2. Emit FEDERATION_READ event to the event chain via insertEventWithChain
 *
 * The hook reads federation context stashed on the request object by the
 * shares.ts route handlers (federationShareId, federationResourceType,
 * federationResourceId).
 */

interface FederationRequestContext {
  federationShareId?: string;
  federationResourceType?: string;
  federationResourceId?: string;
}

/**
 * Register the federation audit onResponse hook on the given Fastify instance.
 *
 * Only fires when federation context is present on the request (set by
 * shares.ts handlers). Non-federation requests pass through unaffected.
 */
export function registerFederationAuditHook(app: FastifyInstance): void {
  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req as unknown as FederationRequestContext;

    // Only fire for federated reads that succeeded
    if (!ctx.federationShareId || !ctx.federationResourceType) return;
    if (reply.statusCode >= 400) return;
    if (!req.user) return;

    const shareId = ctx.federationShareId;
    const resourceType = ctx.federationResourceType;
    const resourceId = ctx.federationResourceId;

    // We're in an onResponse hook running AFTER the route's tx ended, so
    // app.current_tenant_id is unset on whatever pooled connection we get.
    // Both federation_audit's WITH CHECK and federation_share's USING look the
    // share up via tenant GUC; without it the policy subqueries return empty
    // and the audit INSERT fails RLS. Re-establish the reader's tenant scope
    // for the duration of these two queries.
    const readerTenantId = req.user.tenantId;
    try {
      // 1. INSERT into federation_audit  +  2. look up the share — both gated
      //    by RLS that depends on app.current_tenant_id.
      const share = await sql.begin<
        { source_tenant_id: string; subject_tenant_id: string } | undefined
      >(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${readerTenantId}, true)`;
        if (resourceId) {
          await tx`
            INSERT INTO federation_audit (
              federation_share_id, accessed_by_user_id, resource_type, resource_id, action
            )
            VALUES (
              ${shareId}, ${req.user!.id}, ${resourceType}, ${resourceId}, 'read'
            )
          `;
        }
        const rows = await tx<{ source_tenant_id: string; subject_tenant_id: string }[]>`
          SELECT source_tenant_id, subject_tenant_id
          FROM federation_share
          WHERE id = ${shareId}
        `;
        return rows[0];
      });

      if (!share) return;

      // 3. Emit FEDERATION_READ event to the event chain
      await insertEventWithChain({
        tenant_id: share.source_tenant_id,
        subject_tenant_id: share.subject_tenant_id,
        kind: 'FEDERATION_READ',
        payload: {
          share_id: shareId,
          accessed_by_tenant_id: req.user.tenantId,
          accessed_by_user_id: req.user.id,
          resource_type: resourceType,
          resource_id: resourceId ?? null,
        },
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: req.user.id,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
      });
    } catch (err) {
      // Audit failures should not break the response — log and continue
      app.log.error({ err, shareId, resourceType, resourceId }, 'Federation audit hook failed');
    }
  });
}
