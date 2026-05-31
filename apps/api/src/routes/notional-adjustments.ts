import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import {
  CreateNotionalAdjustmentBody,
  NotionalAdjustmentKind,
  type NotionalAdjustment,
  type NotionalAdjustmentKind as Kind,
} from '@cpa/schemas';

/**
 * Subdiv 355-G notional adjustments — REST surface.
 *
 *   GET    /v1/claims/:claim_id/notional-adjustments
 *   POST   /v1/claims/:claim_id/notional-adjustments
 *   DELETE /v1/notional-adjustments/:id
 *
 * Table created by migration 0097. All writes go through `sql` (cpa_app
 * role, RLS enforced) — see CLAUDE.md rule. Tenant context is set on the
 * tx before any DB I/O.
 *
 * The hypothesis_formed_at field is OPTIONAL on create. When supplied,
 * it's immutable post-INSERT (the column has no UPDATE trigger in 0097
 * because each notional-adjustment kind has different forensic
 * requirements; a follow-up migration can add a trigger once the per-
 * kind matrix is locked).
 *
 * No chain events emitted yet — these are accounting line items, not
 * R&D evidence. They feed the application-drafter directly; a future
 * migration can add NOTIONAL_ADJUSTMENT_CREATED to the audit chain if
 * downstream consumers need it.
 */

interface RawRow {
  id: string;
  tenant_id: string;
  claim_id: string;
  kind: Kind;
  amount_aud: string; // postgres NUMERIC → string
  description: string;
  statutory_anchor: string;
  first_recorded_at: string;
  hypothesis_formed_at: string | null;
  created_at: string;
  created_by_user_id: string;
  updated_at: string;
}

function toApi(r: RawRow): NotionalAdjustment {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    claim_id: r.claim_id,
    kind: r.kind,
    amount_aud: r.amount_aud,
    description: r.description,
    statutory_anchor: r.statutory_anchor,
    first_recorded_at: r.first_recorded_at,
    hypothesis_formed_at: r.hypothesis_formed_at,
    created_at: r.created_at,
    created_by_user_id: r.created_by_user_id,
    updated_at: r.updated_at,
  };
}

export function registerNotionalAdjustments(app: FastifyInstance): void {
  // ---------------------------------------------------------------------
  // GET /v1/claims/:claim_id/notional-adjustments
  // ---------------------------------------------------------------------
  app.get<{ Params: { claim_id: string } }>(
    '/v1/claims/:claim_id/notional-adjustments',
    {
      preHandler: requireSession,
      schema: { params: z.object({ claim_id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const { claim_id } = req.params;
      const tenantId = req.user!.tenantId!;
      return await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<RawRow[]>`
          SELECT id::text, tenant_id::text, claim_id::text, kind,
                 amount_aud::text, description, statutory_anchor,
                 first_recorded_at::text, hypothesis_formed_at::text,
                 created_at::text, created_by_user_id::text, updated_at::text
            FROM notional_adjustment
           WHERE claim_id = ${claim_id}
           ORDER BY first_recorded_at ASC, id ASC
        `;
        return reply.send({ adjustments: rows.map(toApi) });
      });
    },
  );

  // ---------------------------------------------------------------------
  // POST /v1/claims/:claim_id/notional-adjustments
  // ---------------------------------------------------------------------
  app.post<{ Params: { claim_id: string } }>(
    '/v1/claims/:claim_id/notional-adjustments',
    {
      preHandler: requireSession,
      schema: { params: z.object({ claim_id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const role = req.user!.role;
      if (role !== 'admin' && role !== 'consultant') {
        return reply.status(403).send({
          error: 'forbidden',
          message: 'Admin or consultant role required',
          requestId: req.id,
        });
      }
      const parsed = CreateNotionalAdjustmentBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'invalid_body',
          message: 'Body must match CreateNotionalAdjustmentBody',
          issues: parsed.error.issues,
          requestId: req.id,
        });
      }
      const body = parsed.data;
      const { claim_id } = req.params;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;

      // Re-validate kind against the enum (defence-in-depth: Zod already
      // narrows via NotionalAdjustmentKind, but the route signature widens
      // when serialised through Fastify — keep an explicit guard).
      const kindParse = NotionalAdjustmentKind.safeParse(body.kind);
      if (!kindParse.success) {
        return reply.status(422).send({
          error: 'invalid_kind',
          message: 'kind must be one of the Subdiv 355-G categories',
          requestId: req.id,
        });
      }

      return await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        // RLS scopes the insert to the caller's tenant via the WITH CHECK
        // clause on notional_adjustment. claim_id integrity is enforced
        // by the FK (cross-tenant claim_id will trip the RLS SELECT on
        // the claim row before this insert lands).
        const inserted = await tx<RawRow[]>`
          INSERT INTO notional_adjustment (
            tenant_id, claim_id, kind, amount_aud, description,
            statutory_anchor, hypothesis_formed_at, created_by_user_id
          ) VALUES (
            ${tenantId}, ${claim_id}, ${body.kind}, ${body.amount_aud},
            ${body.description}, ${body.statutory_anchor},
            ${body.hypothesis_formed_at ?? null}, ${userId}
          )
          RETURNING id::text, tenant_id::text, claim_id::text, kind,
                    amount_aud::text, description, statutory_anchor,
                    first_recorded_at::text, hypothesis_formed_at::text,
                    created_at::text, created_by_user_id::text, updated_at::text
        `;
        const row = inserted[0];
        if (!row) {
          throw new Error('notional_adjustment INSERT returned no row');
        }
        return reply.status(201).send({ adjustment: toApi(row) });
      });
    },
  );

  // ---------------------------------------------------------------------
  // DELETE /v1/notional-adjustments/:id
  // ---------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    '/v1/notional-adjustments/:id',
    {
      preHandler: requireSession,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const role = req.user!.role;
      if (role !== 'admin' && role !== 'consultant') {
        return reply.status(403).send({
          error: 'forbidden',
          message: 'Admin or consultant role required',
          requestId: req.id,
        });
      }
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;
      return await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const deleted = await tx<{ id: string }[]>`
          DELETE FROM notional_adjustment
           WHERE id = ${id}
           RETURNING id::text
        `;
        if (deleted.length === 0) {
          return reply.status(404).send({
            error: 'not_found',
            message: 'Adjustment not found in this firm',
            requestId: req.id,
          });
        }
        return reply.status(204).send();
      });
    },
  );
}
