import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';

/**
 * P9 Phase 3 — Federation share read endpoints.
 *
 * GET /v1/federation/shares                       — list active shares for current tenant
 * GET /v1/federation/shares/:id/claims            — claims under the shared subject_tenant
 * GET /v1/federation/shares/:id/claims/:claimId   — single claim detail + narrative
 */

export function registerFederationShares(app: FastifyInstance): void {
  // ---------------------------------------------------------------
  // GET /v1/federation/shares — list active shares for current tenant (as target)
  // ---------------------------------------------------------------
  app.get('/v1/federation/shares', { preHandler: requireSession }, async (req, reply) => {
    const tenantId = req.user!.tenantId!;

    // All three reads here cross RLS policies that filter on
    // app.current_tenant_id (federation_share USING source-or-target,
    // subject_tenant tenant-isolation, tenant). Without the GUC the
    // policies return empty regardless of the explicit WHERE filters, so
    // the shape "no shares ever" emerges. Bind it inside the tx.
    type ShareRow = {
      id: string;
      subject_tenant_id: string;
      source_tenant_id: string;
      granted_at: Date;
      expires_at: Date | null;
      subject_tenant_name: string;
      source_tenant_name: string;
    };
    const shares = await sql.begin<ShareRow[]>(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return await tx<ShareRow[]>`
        SELECT
          fs.id,
          fs.subject_tenant_id,
          fs.source_tenant_id,
          fs.granted_at,
          fs.expires_at,
          st.name AS subject_tenant_name,
          t.name AS source_tenant_name
        FROM federation_share fs
        JOIN subject_tenant st ON st.id = fs.subject_tenant_id
        JOIN tenant t ON t.id = fs.source_tenant_id
        WHERE fs.target_tenant_id = ${tenantId}
          AND fs.revoked_at IS NULL
          AND (fs.expires_at IS NULL OR fs.expires_at > now())
        ORDER BY fs.granted_at DESC
      `;
    });

    return reply.send({ shares });
  });

  // ---------------------------------------------------------------
  // GET /v1/federation/shares/:id/claims — claims under the shared subject_tenant
  // ---------------------------------------------------------------
  app.get(
    '/v1/federation/shares/:id/claims',
    {
      preHandler: requireSession,
      schema: {
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = req.user!.tenantId!;

      type ClaimRow = {
        id: string;
        fiscal_year: number;
        stage: string;
        created_at: Date;
        updated_at: Date;
      };
      type Result = { kind: 'not_found' } | { kind: 'ok'; claims: ClaimRow[] };
      // Pin app.current_tenant_id for the whole flow — both federation_share
      // (USING source-or-target) and claim (extended-RLS via federation_share)
      // depend on it.
      const result = await sql.begin<Result>(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const shareCheck = await tx<{ subject_tenant_id: string }[]>`
          SELECT subject_tenant_id FROM federation_share
          WHERE id = ${id}
            AND target_tenant_id = ${tenantId}
            AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > now())
        `;
        if (shareCheck.length === 0) return { kind: 'not_found' as const };
        const subjectTenantId = shareCheck[0]!.subject_tenant_id;
        const claims = await tx<ClaimRow[]>`
          SELECT id, fiscal_year, stage, created_at, updated_at
          FROM claim
          WHERE subject_tenant_id = ${subjectTenantId}
          ORDER BY fiscal_year DESC
        `;
        return { kind: 'ok' as const, claims };
      });

      if (result.kind === 'not_found') {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Share not found or inactive',
        });
      }

      // Store share context on request for audit hook
      (req as unknown as Record<string, unknown>)['federationShareId'] = id;
      (req as unknown as Record<string, unknown>)['federationResourceType'] = 'claim';

      return reply.send({ claims: result.claims });
    },
  );

  // ---------------------------------------------------------------
  // GET /v1/federation/shares/:id/claims/:claimId — claim detail + narrative
  // ---------------------------------------------------------------
  app.get(
    '/v1/federation/shares/:id/claims/:claimId',
    {
      preHandler: requireSession,
      schema: {
        params: z.object({
          id: z.string().uuid(),
          claimId: z.string().uuid(),
        }),
      },
    },
    async (req, reply) => {
      const { id, claimId } = req.params as { id: string; claimId: string };
      const tenantId = req.user!.tenantId!;

      type ClaimRow = {
        id: string;
        fiscal_year: number;
        stage: string;
        subject_tenant_id: string;
        created_at: Date;
        updated_at: Date;
      };
      type ActivityRow = {
        id: string;
        code: string;
        kind: string;
        title: string;
        description: string | null;
      };
      type NarrativeRow = {
        activity_id: string;
        section_kind: string;
        status: string;
        content_hash: string;
        current_version: number;
        updated_at: Date;
      };
      type Result =
        | { kind: 'share_not_found' }
        | { kind: 'claim_not_found' }
        | { kind: 'ok'; claim: ClaimRow; activities: ActivityRow[]; narratives: NarrativeRow[] };

      // Pin app.current_tenant_id for the whole flow — federation_share
      // (USING source-or-target) and claim/activity/narrative_draft
      // (extended RLS via federation_share) all depend on it.
      const result = await sql.begin<Result>(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const shareCheck = await tx<{ subject_tenant_id: string }[]>`
          SELECT subject_tenant_id FROM federation_share
          WHERE id = ${id}
            AND target_tenant_id = ${tenantId}
            AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > now())
        `;
        if (shareCheck.length === 0) return { kind: 'share_not_found' as const };

        const claims = await tx<ClaimRow[]>`
          SELECT id, fiscal_year, stage, subject_tenant_id, created_at, updated_at
          FROM claim
          WHERE id = ${claimId}
        `;
        if (claims.length === 0) return { kind: 'claim_not_found' as const };
        const claim = claims[0]!;

        const activities = await tx<ActivityRow[]>`
          SELECT id, code, kind, title, description
          FROM activity
          WHERE claim_id = ${claimId}
          ORDER BY code
        `;
        const activityIds = activities.map((a) => a.id);
        const narratives =
          activityIds.length > 0
            ? await tx<NarrativeRow[]>`
                SELECT activity_id, section_kind, status, content_hash, current_version, updated_at
                FROM narrative_draft
                WHERE activity_id = ANY(${activityIds})
                ORDER BY activity_id, section_kind
              `
            : [];
        return { kind: 'ok' as const, claim, activities, narratives };
      });

      if (result.kind === 'share_not_found') {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Share not found or inactive',
        });
      }
      if (result.kind === 'claim_not_found') {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Claim not found or not accessible via this share',
        });
      }

      // Store share context on request for audit hook
      (req as unknown as Record<string, unknown>)['federationShareId'] = id;
      (req as unknown as Record<string, unknown>)['federationResourceType'] = 'claim';
      (req as unknown as Record<string, unknown>)['federationResourceId'] = claimId;

      return reply.send({
        claim: result.claim,
        activities: result.activities,
        narratives: result.narratives,
      });
    },
  );
}
