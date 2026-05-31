import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { DeliveryKindEnum } from '@cpa/schemas';
import { emitClaimUsageRecord } from '../jobs/emit-claim-usage-record.js';
import { toApi, type ClaimsRouteDeps, type RawClaimRow } from './claims-shared.js';

/**
 * Register the delivery-kind mutation route. Split from the monolithic
 * claims.ts so the Stripe-dependent code path lives next to its
 * dependency injection point.
 */
export function registerClaimsDelivery(app: FastifyInstance, deps?: ClaimsRouteDeps): void {
  const { stripe } = deps ?? {};

  // ---------------------------------------------------------------------
  // PATCH /v1/claims/:id/deliver — set delivery_kind (NULL → value) and
  // emit a Stripe per-claim usage record via emitClaimUsageRecord.
  //
  // Called once per claim when the consultant decides whether the claim
  // will be delivered as a quarterly_assurance or annual_claim. Setting
  // delivery_kind for the first time triggers the metered usage record.
  //
  // Idempotency: emitClaimUsageRecord guards against double-billing via
  // platform_fee_charged_at (see job JSDoc). This route still allows
  // re-setting delivery_kind (e.g. to correct a typo) without re-billing.
  //
  // No Stripe configured: if deps.stripe is undefined (local dev / tests
  // that don't pass deps), the DB update still lands but no usage record
  // is posted. This matches the pattern in prompt-suggestions.ts where
  // the AI client is optional in dev.
  // ---------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    '/v1/claims/:id/deliver',
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

      const bodyParsed = DeliveryKindEnum.safeParse(
        (req.body as Record<string, unknown>)?.delivery_kind,
      );
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: 'Body must be { delivery_kind: "quarterly_assurance" | "annual_claim" }',
          requestId: req.id,
        });
      }
      const delivery_kind = bodyParsed.data;
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;

      // Set delivery_kind and return the updated row in one transaction.
      const result = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const updated = await tx<RawClaimRow[]>`
          UPDATE claim
             SET delivery_kind = ${delivery_kind},
                 updated_at    = NOW()
           WHERE id        = ${id}
             AND tenant_id = ${tenantId}
           RETURNING id, tenant_id, subject_tenant_id, fiscal_year, stage,
                     delivery_kind, platform_fee_charged_at,
                     ausindustry_reference, submitted_at, submitted_by_user_id,
                     created_at, updated_at,
                     (workflow_state IS NOT NULL) AS is_wizard_claim
        `;
        const row = updated[0];
        return row ?? null;
      });

      if (!result) {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }

      // Emit usage record if stripe is configured. Fire-and-forget with
      // error logging — a transient Stripe failure here is not fatal to
      // the API response; pg-boss retry handles persistence.
      if (stripe) {
        emitClaimUsageRecord({ claim_id: id, tenant_id: tenantId }, stripe).catch(
          (err: unknown) => {
            app.log.error({ err, claim_id: id }, 'emit-claim-usage-record failed');
          },
        );
      }

      return reply.status(200).send({ claim: toApi(result) });
    },
  );
}
