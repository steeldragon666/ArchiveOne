/**
 * GET /v1/claims/:id/ip-search/verdicts
 *
 * Lists all verdicts for a claim, with their status (draft when
 * `approved_at IS NULL`, approved otherwise). Used by Wizard Step 2 to
 * hydrate the per-hypothesis cards on page load.
 *
 * RLS scopes the query to the caller's firm; we also filter by claim_id
 * explicitly for the same defence-in-depth reason as
 * `claim-budget.ts`.
 */
import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { Uuid } from './helpers.js';

interface VerdictListRow {
  id: string;
  activity_id: string;
  hypothesis_text: string;
  verdict: 'pass' | 'fail' | 'inconclusive';
  draft_verdict: 'pass' | 'fail' | 'inconclusive' | null;
  analysis_markdown: string;
  approved_by_user_id: string | null;
  approved_at: string | null;
}

export function registerIpSearchList(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id/ip-search/verdicts',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id: claimId } = req.params;
      const tenantId = req.user!.tenantId!;

      if (!Uuid.safeParse(claimId).success) {
        return reply.status(400).send({
          error: 'invalid_path',
          message: 'claim id must be a uuid',
          requestId: req.id,
        });
      }

      return await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        // Confirm the claim is visible — same 404 ergonomics as the
        // budget route.
        const claimRows = await tx<{ id: string }[]>`
          SELECT id::text AS id
            FROM claim
           WHERE id        = ${claimId}
             AND tenant_id = ${tenantId}
        `;
        if (claimRows.length === 0) {
          return reply.status(404).send({
            error: 'claim_not_found',
            message: 'no claim with that id in this firm',
            requestId: req.id,
          });
        }

        const rows = await tx<VerdictListRow[]>`
          SELECT id::text                  AS id,
                 activity_id::text         AS activity_id,
                 hypothesis_text,
                 verdict,
                 draft_verdict,
                 analysis_markdown,
                 approved_by_user_id::text AS approved_by_user_id,
                 approved_at::text         AS approved_at
            FROM ip_search_verdict
           WHERE claim_id  = ${claimId}
             AND tenant_id = ${tenantId}
           ORDER BY approved_at DESC NULLS FIRST, hypothesis_text ASC
        `;

        return reply.status(200).send({
          verdicts: rows.map((r) => ({
            id: r.id,
            activityId: r.activity_id,
            hypothesisText: r.hypothesis_text,
            verdict: r.verdict,
            draftVerdict: r.draft_verdict,
            analysisMarkdown: r.analysis_markdown,
            approvedByUserId: r.approved_by_user_id,
            approvedAt: r.approved_at,
            status: r.approved_at === null ? ('draft' as const) : ('approved' as const),
          })),
        });
      });
    },
  );
}
