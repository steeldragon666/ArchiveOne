/**
 * POST /v1/ip-search/verdicts/:id/override
 *
 * Body: `{ verdict, reasoningMarkdown }`.
 *
 * Consultant overrides the LLM-drafted verdict. The new `verdict`
 * replaces the final value, the `reasoningMarkdown` REPLACES
 * `analysis_markdown` (so the rendered PDF/audit trail carries the
 * consultant's reasoning, not the stale LLM draft), and `draft_verdict`
 * is preserved on the row so downstream audit can show "LLM said X,
 * consultant said Y".
 *
 * Reasoning is REQUIRED — the Zod schema enforces a 30-char minimum so
 * we don't accept "ok" / "fine" overrides. The wizard UI surfaces this
 * as a modal that disables submit until the field is non-trivially
 * populated.
 */
import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { OverrideBody, Uuid } from './helpers.js';

export function registerIpSearchOverride(app: FastifyInstance): void {
  app.post<{ Params: { id: string } }>(
    '/v1/ip-search/verdicts/:id/override',
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

      const bodyParse = OverrideBody.safeParse(req.body);
      if (!bodyParse.success) {
        return reply.status(400).send({
          error: 'invalid_body',
          message:
            'Body must be { verdict: pass|fail|inconclusive, reasoningMarkdown: string (>= 30 chars) }',
          requestId: req.id,
        });
      }
      const { verdict, reasoningMarkdown } = bodyParse.data;

      return await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        const updated = await tx<
          {
            id: string;
            verdict: 'pass' | 'fail' | 'inconclusive';
            draft_verdict: 'pass' | 'fail' | 'inconclusive' | null;
            analysis_markdown: string;
            approved_at: string;
          }[]
        >`
          UPDATE ip_search_verdict
             SET verdict             = ${verdict},
                 analysis_markdown   = ${reasoningMarkdown},
                 approved_by_user_id = ${userId},
                 approved_at         = now()
           WHERE id        = ${id}
             AND tenant_id = ${tenantId}
          RETURNING id::text         AS id,
                    verdict,
                    draft_verdict,
                    analysis_markdown,
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
