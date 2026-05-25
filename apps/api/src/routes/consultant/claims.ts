import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '@cpa/auth';
// POST runs AFTER session middleware sets app.current_tenant_id — RLS is
// active, so use the regular `sql` client (cpa_app). See dev-login.ts
// for the counter-example where privilegedSql is required because the
// session hasn't been minted yet.
import { sql } from '@cpa/db/client';
import { initialWorkflowState } from '../../lib/workflow.js';

/**
 * Body schema for POST /v1/consultant/claims.
 *
 * Accepts an optional `client_id` (subject_tenant id). The "+ New claim"
 * button on the consultant dashboard fires without any client context —
 * the user picks the claimant inside the wizard's step 1. Until that
 * wizard step is wired, this endpoint:
 *
 *   - If `client_id` is provided, scopes the new draft claim to that
 *     subject_tenant (must be visible under RLS, else 404).
 *   - If `client_id` is null/omitted, picks the most recently-touched
 *     subject_tenant under the caller's tenant as a placeholder. The
 *     wizard's step 1 will let the user reassign before any commitment.
 *     If the tenant has no subject_tenant rows, returns 422 `no_clients`
 *     so the UI can prompt the user to import a client first.
 *
 * `subject_tenant_id` is NOT NULL by migration 0012, so a placeholder
 * is the only way to land a draft row without a schema change — a
 * fully-nullable draft state is deferred to a separate migration once
 * the wizard's "create new client inline" flow lands.
 */
const CreateConsultantClaimBody = z.object({
  client_id: z.string().uuid().nullable().optional(),
});

/**
 * Australian fiscal year for a given date — runs 1 Jul YYYY-1 to 30 Jun YYYY.
 *
 * FY26 = 1 Jul 2025 to 30 Jun 2026. ATO/AusIndustry "FY" refers to the
 * year the FY ends, so a date in Mar 2026 belongs to FY26.
 */
function currentAuFiscalYear(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0 = Jan
  // Jul (6) onwards belongs to the next FY's end year.
  return month >= 6 ? year + 1 : year;
}

/**
 * POST /v1/consultant/claims — create a draft claim for the wizard.
 *
 * RLS-scoped via the session middleware's `app.current_tenant_id` GUC.
 * Never accepts a `tenant_id` body field — the caller's session is the
 * only authority on which firm the claim belongs to.
 *
 * Returns `{ id }` on success (201) — the client navigates to
 * `/consultant/claim/<id>/wizard` to fill in the rest.
 *
 * The UNIQUE (subject_tenant_id, fiscal_year) constraint enforces one
 * claim per claimant per FY — we pick the next free FY (up to +5 years)
 * rather than 409'ing, since "start a new claim" should always succeed
 * for a consultant click. Gives up and 409s only if the next 5 years
 * are all taken.
 */
export function registerConsultantClaimsCreate(app: FastifyInstance): void {
  app.post('/v1/consultant/claims', { preHandler: requireSession }, async (req, reply) => {
    const role = req.user!.role;
    if (role !== 'admin' && role !== 'consultant') {
      return reply.status(403).send({
        error: 'forbidden',
        message: 'Admin or consultant role required',
        requestId: req.id,
      });
    }

    const parsed = CreateConsultantClaimBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_body',
        message: 'Body must be { client_id?: uuid | null }',
        requestId: req.id,
      });
    }
    const { client_id } = parsed.data;
    const tenantId = req.user!.tenantId!;

    return await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

      // Resolve the subject_tenant — either caller-supplied or fallback.
      let subjectTenantId: string;
      if (client_id) {
        const rows = await tx<{ id: string }[]>`
          SELECT id FROM subject_tenant
           WHERE id = ${client_id}
             AND tenant_id = ${tenantId}
             AND deleted_at IS NULL
        `;
        if (rows.length === 0) {
          return reply.status(404).send({
            error: 'client_not_found',
            message: 'No subject_tenant with that id in this firm',
            requestId: req.id,
          });
        }
        subjectTenantId = rows[0]!.id;
      } else {
        // Placeholder: pick the most-recently-touched claimant in the tenant.
        // The wizard's step 1 (W1) reassigns before the claim becomes real.
        const rows = await tx<{ id: string }[]>`
          SELECT id FROM subject_tenant
           WHERE tenant_id = ${tenantId}
             AND deleted_at IS NULL
           ORDER BY updated_at DESC, created_at DESC
           LIMIT 1
        `;
        if (rows.length === 0) {
          return reply.status(422).send({
            error: 'no_clients',
            message:
              'No clients exist in this firm yet. Import a client before starting a claim.',
            requestId: req.id,
          });
        }
        subjectTenantId = rows[0]!.id;
      }

      // First free fiscal year, starting from the current AU FY. UNIQUE
      // (subject_tenant_id, fiscal_year) means a draft for an already-
      // claimed FY would collide; search forward up to 5 years.
      const baseFy = currentAuFiscalYear();
      let chosenFy: number | null = null;
      for (let offset = 0; offset < 5; offset++) {
        const candidate = baseFy + offset;
        const existing = await tx<{ id: string }[]>`
          SELECT id FROM claim
           WHERE subject_tenant_id = ${subjectTenantId}
             AND fiscal_year = ${candidate}
        `;
        if (existing.length === 0) {
          chosenFy = candidate;
          break;
        }
      }
      if (chosenFy === null) {
        return reply.status(409).send({
          error: 'no_free_fiscal_year',
          message:
            'This client already has claims for the next 5 fiscal years. Pick a different client.',
          requestId: req.id,
        });
      }

      const initialState = initialWorkflowState(new Date().toISOString());
      const newId = crypto.randomUUID();
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO claim (
          id, tenant_id, subject_tenant_id, fiscal_year, stage, workflow_state
        )
        VALUES (
          ${newId}, ${tenantId}, ${subjectTenantId}, ${chosenFy}, 'engagement',
          ${JSON.stringify(initialState)}::text::jsonb
        )
        RETURNING id
      `;
      if (inserted.length === 0) {
        throw new Error('POST /v1/consultant/claims: INSERT returned no row');
      }
      return reply.status(201).send({ id: inserted[0]!.id });
    });
  });
}
