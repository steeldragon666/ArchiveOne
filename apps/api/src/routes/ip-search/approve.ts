/**
 * POST /v1/ip-search/verdicts/:id/approve
 *
 * Consultant accepts the LLM-drafted verdict as final. Sets
 * `approved_by_user_id` + `approved_at` on the row; leaves `verdict`
 * and `draft_verdict` unchanged (they are already equal post-draft).
 *
 * Idempotency
 * -----------
 * Approving an already-approved row is allowed: the second call
 * UPDATEs `approved_at = now()` and returns 200. We do NOT track
 * "first approval" timestamp — for the audit trail we lean on the
 * downstream Wizard Step 2 PDF task which records who approved by
 * embedding `approved_by_user_id` into the rendered evidence row.
 */
import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { Uuid } from './helpers.js';

export function registerIpSearchApprove(app: FastifyInstance): void {
  app.post<{ Params: { id: string } }>(
    '/v1/ip-search/verdicts/:id/approve',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;

      if (!Uuid.safeParse(id).success) {
        return reply.status(400).send({
          error: 'invalid_path',
          message: 'verdict id must be a uuid',
          requestId: req.id,
        });
      }

      return await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        const updated = await tx<
          {
            id: string;
            verdict: 'pass' | 'fail' | 'inconclusive';
            draft_verdict: 'pass' | 'fail' | 'inconclusive' | null;
            approved_at: string;
          }[]
        >`
          UPDATE ip_search_verdict
             SET approved_by_user_id = ${userId},
                 approved_at         = now()
           WHERE id        = ${id}
             AND tenant_id = ${tenantId}
          RETURNING id::text       AS id,
                    verdict,
                    draft_verdict,
                    approved_at::text AS approved_at
        `;
        if (updated.length === 0) {
          return reply.status(404).send({
            error: 'verdict_not_found',
            message: 'no verdict with that id in this firm',
            requestId: req.id,
          });
        }
        return reply.status(200).send(updated[0]);
      });
    },
  );
}
