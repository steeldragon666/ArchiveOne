import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { requireSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { syncMobileQuantity } from '../lib/mobile-quantity-sync.js';

export interface ClaimantsRouteDeps {
  stripe?: Stripe;
}

/**
 * Routes for claimant (subject_tenant) operations — P9.1.10.
 *
 * POST /v1/claimants/:id/mobile-subscribe
 *   Subscribe a claimant to mobile. Inserts a claimant_mobile_subscription row,
 *   then recomputes the tenant's bulk-discount quantity and syncs to Stripe.
 *
 * POST /v1/claimants/:id/mobile-unsubscribe
 *   Unsubscribe a claimant from mobile. Soft-deletes the active
 *   claimant_mobile_subscription (sets ended_at = NOW()), then recomputes
 *   and syncs to Stripe.
 *
 * Auth: requireSession + admin-or-consultant gating.
 * Stripe sync: fire-and-await — Stripe errors propagate as 500s so the
 * client can retry. The DB write is committed before the Stripe call, so
 * a Stripe failure leaves the DB state ahead of Stripe; a retry will
 * recompute the correct quantity from the DB.
 */
export function registerClaimants(app: FastifyInstance, deps?: ClaimantsRouteDeps): void {
  const { stripe } = deps ?? {};

  // ---------------------------------------------------------------------------
  // POST /v1/claimants/:id/mobile-subscribe
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>(
    '/v1/claimants/:id/mobile-subscribe',
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

      const subjectTenantId = req.params.id;
      const tenantId = req.user!.tenantId!;

      // Confirm the subject_tenant exists and belongs to this firm (RLS guard).
      const visible = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ id: string }[]>`
          SELECT id FROM subject_tenant
           WHERE id = ${subjectTenantId}
             AND deleted_at IS NULL
        `;
        return rows[0] != null;
      });
      if (!visible) {
        return reply.status(404).send({
          error: 'claimant_not_found',
          message: 'No claimant with that id in this firm',
          requestId: req.id,
        });
      }

      // Check that this claimant isn't already subscribed (active row exists).
      const alreadyActive = await privilegedSql<{ id: string }[]>`
        SELECT id FROM claimant_mobile_subscription
         WHERE tenant_id = ${tenantId}
           AND subject_tenant_id = ${subjectTenantId}
           AND ended_at IS NULL
         LIMIT 1
      `;
      if (alreadyActive[0]) {
        return reply.status(409).send({
          error: 'already_subscribed',
          message: 'This claimant already has an active mobile subscription',
          requestId: req.id,
        });
      }

      // Insert the subscription row (privileged: bypasses RLS so the
      // concurrent advisory lock in syncMobileQuantity sees a consistent view).
      await privilegedSql`
        INSERT INTO claimant_mobile_subscription (id, tenant_id, subject_tenant_id)
        VALUES (${crypto.randomUUID()}, ${tenantId}, ${subjectTenantId})
      `;

      // Sync quantity to Stripe if billing is configured.
      if (stripe) {
        await syncMobileQuantity({ tenant_id: tenantId }, stripe);
      }

      return reply.status(204).send();
    },
  );

  // ---------------------------------------------------------------------------
  // POST /v1/claimants/:id/mobile-unsubscribe
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>(
    '/v1/claimants/:id/mobile-unsubscribe',
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

      const subjectTenantId = req.params.id;
      const tenantId = req.user!.tenantId!;

      // Soft-delete the active subscription for this claimant.
      const updated = await privilegedSql<{ id: string }[]>`
        UPDATE claimant_mobile_subscription
           SET ended_at = NOW(), updated_at = NOW()
         WHERE tenant_id = ${tenantId}
           AND subject_tenant_id = ${subjectTenantId}
           AND ended_at IS NULL
         RETURNING id
      `;

      if (!updated[0]) {
        return reply.status(404).send({
          error: 'mobile_subscription_not_found',
          message: 'No active mobile subscription found for this claimant',
          requestId: req.id,
        });
      }

      // Sync quantity to Stripe if billing is configured.
      if (stripe) {
        await syncMobileQuantity({ tenant_id: tenantId }, stripe);
      }

      return reply.status(204).send();
    },
  );
}
