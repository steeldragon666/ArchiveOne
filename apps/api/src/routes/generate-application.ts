/**
 * Application-generation endpoints.
 *
 *   POST /v1/claims/:id/generate-application
 *       Enqueues a generate-application pg-boss job. Returns 202 with a
 *       job_id so the UI can show "drafting..." immediately.
 *
 *   GET  /v1/claims/:id/application-draft
 *       Returns the current draft state for a claim. While the worker is
 *       still running this returns { status: 'drafting' }. When complete
 *       it returns the full ApplicationDraft JSON.
 *
 * Auth: requireSession. Tenant-scoped via the user's session.
 *
 * NOTE: this endpoint references the claim.application_draft_* columns
 * which don't yet exist in a migration — the worker falls back to writing
 * the draft to workflow_state.application_draft JSON until the migration
 * adds proper columns. The GET endpoint reads either location.
 */
import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { getBoss } from '../lib/pg-boss-client.js';
import { GENERATE_APPLICATION_QUEUE } from '../jobs/generate-application.js';

export function registerGenerateApplication(app: FastifyInstance): void {
  // POST: enqueue
  app.post<{ Params: { id: string } }>(
    '/v1/claims/:id/generate-application',
    { preHandler: requireSession },
    async (req, reply) => {
      const claimId = req.params.id;
      const tenantId = req.user!.tenantId!;

      // Load + validate the claim is in this tenant.
      const rows = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return await tx<{ id: string; subject_tenant_id: string }[]>`
          SELECT id::text, subject_tenant_id::text
            FROM claim
           WHERE id        = ${claimId}
             AND tenant_id = ${tenantId}
           LIMIT 1
        `;
      });
      const claim = rows[0];
      if (!claim) {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }

      const boss = await getBoss();
      const jobId = await boss.send(GENERATE_APPLICATION_QUEUE, {
        claim_id: claim.id,
        tenant_id: tenantId,
        subject_tenant_id: claim.subject_tenant_id,
      });

      return reply.status(202).send({
        status: 'queued',
        job_id: jobId,
        message:
          'Application draft enqueued. Poll GET /v1/claims/' +
          claim.id +
          '/application-draft to track progress.',
      });
    },
  );

  // GET: status + draft (when complete)
  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id/application-draft',
    { preHandler: requireSession },
    async (req, reply) => {
      const claimId = req.params.id;
      const tenantId = req.user!.tenantId!;

      const rows = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return await tx<
          {
            id: string;
            workflow_state: Record<string, unknown> | null;
          }[]
        >`
          SELECT id::text, workflow_state
            FROM claim
           WHERE id        = ${claimId}
             AND tenant_id = ${tenantId}
           LIMIT 1
        `;
      });
      const claim = rows[0];
      if (!claim) {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }

      const draftFromWorkflow = claim.workflow_state?.['application_draft'];
      if (draftFromWorkflow) {
        return reply.status(200).send({
          status: 'complete',
          draft: draftFromWorkflow,
        });
      }

      return reply.status(200).send({
        status: 'pending',
        message:
          'No application draft yet. POST /v1/claims/' +
          claim.id +
          '/generate-application to start drafting.',
      });
    },
  );
}
