import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { privilegedSql } from '@cpa/db/client';

/**
 * Tenant activation gate — P9.1.7.
 *
 * Registered as a preHandler hook that runs after the session plugin has
 * attached req.user. Gates API access based on the tenant's billing state:
 *
 *   billing_mode='trial':
 *     trial_status='active'    → pass-through
 *     trial_status='expired'   → 402 trial_expired
 *     trial_status='converted' → billing_mode='paid' path (query subscription)
 *
 *   billing_mode='paid':
 *     subscription.status='trialing'|'active' → pass-through
 *     subscription.status='past_due'          → pass-through + X-Billing-Alert header
 *     subscription.status='cancelled'         → reads (GET/HEAD) allowed; writes 402
 *     subscription.status='incomplete'        → 402 payment_incomplete
 *     no subscription found                   → 402 payment_incomplete (fail-safe)
 *
 *   billing_mode='archived' → 402 account_archived
 *   tenant not found        → 402 account_not_found (fail-safe)
 *
 * Skips unauthenticated requests (no req.user or no tenantId). Must be
 * registered in a child scope that is initialized after the session plugin so
 * the hook execution order is: session → gate.
 *
 * Uses privilegedSql to bypass RLS — needed because:
 *   1. subscription has RLS enabled and the GUC may not be set for this
 *      connection's query at the exact moment the hook runs.
 *   2. We must read billing state even for expired/cancelled tenants, where
 *      RLS would normally deny access.
 */

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface TenantBillingRow {
  billing_mode: 'trial' | 'paid' | 'archived';
  trial_status: 'active' | 'expired' | 'converted';
}

interface SubscriptionRow {
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'incomplete';
}

export function registerTenantActivationGate(app: FastifyInstance): void {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return; // anonymous request — gate skips

    const tenantRows = await privilegedSql<TenantBillingRow[]>`
      SELECT billing_mode, trial_status
        FROM tenant
       WHERE id = ${tenantId}
         AND deleted_at IS NULL
    `;

    const tenant = tenantRows[0];
    if (!tenant) {
      return reply.status(402).send({
        error: 'account_not_found',
        message: 'No active account was found for this session.',
        requestId: req.id,
      });
    }

    const { billing_mode, trial_status } = tenant;

    if (billing_mode === 'archived') {
      return reply.status(402).send({
        error: 'account_archived',
        message: 'This account has been archived. Contact support to reactivate.',
        requestId: req.id,
      });
    }

    if (billing_mode === 'trial') {
      if (trial_status === 'active') return; // pass-through
      // expired (or converted with no subscription — should not occur in production)
      return reply.status(402).send({
        error: 'trial_expired',
        message: 'Your trial has expired. Please upgrade to continue.',
        requestId: req.id,
      });
    }

    // billing_mode === 'paid' — look up subscription
    const subRows = await privilegedSql<SubscriptionRow[]>`
      SELECT status
        FROM subscription
       WHERE tenant_id = ${tenantId}
       ORDER BY created_at DESC
       LIMIT 1
    `;

    const sub = subRows[0];
    if (!sub) {
      return reply.status(402).send({
        error: 'payment_incomplete',
        message: 'Payment setup is incomplete. Please contact support.',
        requestId: req.id,
      });
    }

    switch (sub.status) {
      case 'trialing':
      case 'active':
        return; // pass-through

      case 'past_due':
        void reply.header('x-billing-alert', 'past_due');
        return; // pass-through with alert header

      case 'cancelled':
        if (WRITE_METHODS.has(req.method)) {
          return reply.status(402).send({
            error: 'subscription_cancelled',
            message: 'Your subscription has been cancelled. Upgrade to continue writing data.',
            requestId: req.id,
          });
        }
        return; // reads allowed

      case 'incomplete':
        return reply.status(402).send({
          error: 'payment_incomplete',
          message: 'Payment is incomplete. Please complete your billing setup.',
          requestId: req.id,
        });

      default:
        return reply.status(402).send({
          error: 'payment_incomplete',
          message: 'Billing state is unknown. Please contact support.',
          requestId: req.id,
        });
    }
  });
}
