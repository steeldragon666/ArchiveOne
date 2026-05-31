import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { evaluateFinalisationGates } from '../lib/finalisation-gates.js';
import { getBoss } from '../lib/pg-boss-client.js';
import {
  CLAIM_FINALISATION_JOB_NAME,
  type ClaimFinalisationJobInput,
} from '../jobs/claim-finalisation.js';
import { type ClaimsRouteDeps } from './claims-shared.js';

/**
 * Register the finalisation routes: kick off the pg-boss job, expose the
 * read-only compliance-gate preview, surface async progress, and serve
 * the completed narrative draft + PDF URLs.
 */
export function registerClaimsFinalisation(app: FastifyInstance, _deps?: ClaimsRouteDeps): void {
  // -----------------------------------------------------------------------
  // POST /v1/claims/:id/finalise
  // Kicks off the claim-finalisation pg-boss job.
  // Returns { job_id, claim_id }
  // -----------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/claims/:id/finalise',
    { preHandler: requireSession },
    async (req, reply) => {
      const role = req.user!.role;
      if (role !== 'admin' && role !== 'consultant') {
        return reply.status(403).send({
          error: 'forbidden',
          message: 'Admin or consultant role required',
          requestId: req.id,
        });
      }

      // Production guard — see claim-finalisation.ts. The job currently
      // writes a hardcoded skeleton narrative rather than calling the real
      // drafter; without this gate a paying tenant would receive a fake
      // AI-branded narrative. Local dev + CI set CLAIM_FINALISATION_STUB_ALLOWED=1.
      if (process.env.CLAIM_FINALISATION_STUB_ALLOWED !== '1') {
        return reply.status(503).send({
          error: 'feature_not_available',
          message:
            'Finalise is not yet available. The narrative-drafter wiring is in development; reach out at feedback@archiveone.com.au for the early-access rollout.',
          requestId: req.id,
        });
      }

      const { id } = req.params;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;

      // Verify claim exists + run pre-flight compliance gates inside the
      // same tx so a concurrent activity edit can't slip violations past
      // the snapshot we evaluate here. evaluateFinalisationGates enforces
      // the post-0097 rules: overseas Findings present where required,
      // supporting activities point at a parent core, hypothesis_formed_at
      // populated everywhere (see lib/finalisation-gates.ts for the full
      // matrix).
      const preflight = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ id: string; stage: string }[]>`
          SELECT id, stage FROM claim WHERE id = ${id} AND tenant_id = ${tenantId}
        `;
        const row = rows[0] ?? null;
        if (row === null) return { kind: 'not_found' as const };
        const gates = await evaluateFinalisationGates(
          tx as unknown as Parameters<typeof evaluateFinalisationGates>[0],
          id,
        );
        return { kind: 'ok' as const, row, gates };
      });

      if (preflight.kind === 'not_found') {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }
      if (!preflight.gates.ok) {
        return reply.status(409).send({
          error: 'finalisation_blocked',
          message: `Finalise blocked by ${preflight.gates.violations.length} compliance violation${preflight.gates.violations.length === 1 ? '' : 's'}. Resolve them and try again.`,
          violations: preflight.gates.violations,
          requestId: req.id,
        });
      }
      // preflight.row is intentionally not read further — the existence
      // check above is the only need. (404 already handled via
      // preflight.kind === 'not_found'.)

      // Advance stage to narrative_drafting.
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        await tx`
          UPDATE claim
             SET stage              = 'narrative_drafting',
                 finalisation_status = 'queued',
                 updated_at          = NOW()
           WHERE id = ${id} AND tenant_id = ${tenantId}
        `;
      });

      // Enqueue the pg-boss job. In non-test environments getBoss() is live.
      let job_id: string;
      try {
        const boss = await getBoss();
        const jobInput: ClaimFinalisationJobInput = {
          claim_id: id,
          tenant_id: tenantId,
          triggered_by_user_id: userId,
        };
        const sent = await boss.send(CLAIM_FINALISATION_JOB_NAME, jobInput);
        job_id = sent ?? `local-${crypto.randomUUID()}`;
      } catch (err) {
        // pg-boss not available in some environments — run inline (best-effort).
        app.log.warn({ err }, 'pg-boss unavailable; running finalisation inline');
        job_id = `inline-${crypto.randomUUID()}`;
        // Fire-and-forget inline execution.
        import('../jobs/claim-finalisation.js')
          .then(({ runClaimFinalisationJob }) => {
            void runClaimFinalisationJob({
              claim_id: id,
              tenant_id: tenantId,
              triggered_by_user_id: userId,
            }).catch((e: unknown) => {
              app.log.error({ err: e }, 'inline finalisation failed');
            });
          })
          .catch((e: unknown) => {
            app.log.error({ err: e }, 'claim-finalisation import failed');
          });
      }

      return reply.status(202).send({ job_id, claim_id: id });
    },
  );

  // -----------------------------------------------------------------------
  // GET /v1/claims/:id/finalisation-gates
  //
  // Read-only preview of the same compliance gates POST /finalise runs
  // in its pre-flight check. Lets the wizard surface violations live on
  // every page-load + after each activity / entity edit so the consultant
  // sees what's blocking submission BEFORE clicking the Submit button.
  //
  // Returns { ok, violations[] } directly — same envelope shape the
  // POST /finalise route uses in its 409 response, so the UI can share
  // a single rendering component for both code paths.
  // -----------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id/finalisation-gates',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;

      const result = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        // Confirm the claim is visible to the caller's tenant before
        // running the gate — otherwise we'd leak "claim exists" via the
        // empty-violations result for a cross-tenant id.
        const claimRows = await tx<{ id: string }[]>`
          SELECT id FROM claim WHERE id = ${id} AND tenant_id = ${tenantId}
        `;
        if (claimRows.length === 0) return { kind: 'not_found' as const };
        const gates = await evaluateFinalisationGates(
          tx as unknown as Parameters<typeof evaluateFinalisationGates>[0],
          id,
        );
        return { kind: 'ok' as const, gates };
      });

      if (result.kind === 'not_found') {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }
      return reply.status(200).send({
        ok: result.gates.ok,
        violations: result.gates.violations,
      });
    },
  );

  // -----------------------------------------------------------------------
  // GET /v1/claims/:id/finalisation-status
  // Returns { status, progress: { activities_drafted, total_activities, pdfs_generated, total_pdfs } }
  // -----------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id/finalisation-status',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;

      const row = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<
          {
            finalisation_status: string | null;
            finalisation_progress: unknown;
          }[]
        >`
          SELECT finalisation_status, finalisation_progress
            FROM claim
           WHERE id = ${id} AND tenant_id = ${tenantId}
        `;
        return rows[0] ?? null;
      });

      if (!row) {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }

      const progress =
        (row.finalisation_progress as {
          activities_drafted?: number;
          total_activities?: number;
          pdfs_generated?: number;
          total_pdfs?: number;
        } | null) ?? {};

      return reply.status(200).send({
        status: row.finalisation_status ?? 'not_started',
        progress: {
          activities_drafted: progress.activities_drafted ?? 0,
          total_activities: progress.total_activities ?? 0,
          pdfs_generated: progress.pdfs_generated ?? 0,
          total_pdfs: progress.total_pdfs ?? 6,
        },
      });
    },
  );

  // -----------------------------------------------------------------------
  // GET /v1/claims/:id/final-draft
  // Returns the completed narrative sections + PDF download URLs.
  // -----------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id/final-draft',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;

      const result = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        const claimRows = await tx<{ id: string; stage: string }[]>`
          SELECT id, stage FROM claim WHERE id = ${id} AND tenant_id = ${tenantId}
        `;
        if (!claimRows[0]) return null;

        const draftRows = await tx<
          {
            activity_id: string;
            activity_code: string;
            activity_title: string;
            segments: unknown;
            updated_at: string;
          }[]
        >`
          SELECT nd.activity_id,
                 a.code  AS activity_code,
                 a.title AS activity_title,
                 nd.segments,
                 nd.updated_at::text
            FROM narrative_draft nd
            JOIN activity a ON a.id = nd.activity_id
           WHERE a.claim_id = ${id}
             AND nd.tenant_id = ${tenantId}
             AND nd.section_kind = 'new_knowledge'
             AND nd.status IN ('complete', 'accepted')
           ORDER BY a.code ASC
        `;

        return {
          stage: claimRows[0].stage,
          drafts: draftRows,
        };
      });

      if (!result) {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }

      const sections = result.drafts.map((d) => {
        const segments = (d.segments as Array<{ type: string; text?: string }> | null) ?? [];
        const prose = segments.map((s) => s.text ?? '').join('\n\n');
        return {
          activity_id: d.activity_id,
          activity_code: d.activity_code,
          activity_title: d.activity_title,
          prose,
          generated_at: d.updated_at,
        };
      });

      return reply.status(200).send({
        claim_id: id,
        sections,
        pdf_urls: {
          claim_summary: `/v1/claims/${id}/summary.pdf`,
          apportionment: `/v1/claims/${id}/apportionment.pdf`,
        },
        locked: result.stage === 'submitted' || result.stage === 'audit_defence',
      });
    },
  );
}
