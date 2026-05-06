import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { z } from 'zod';
import { requireSession } from '@cpa/auth';
import { privilegedSql } from '@cpa/db/client';
import { SlaTierEnum, SLA_TIER_RANK, SLA_TIER_PRICE_ENV } from '@cpa/schemas';

export interface BillingPlanRouteDeps {
  stripe: Stripe;
}

/**
 * POST /v1/billing/change-plan — P9.2.1
 *
 * Upgrades or downgrades the tenant's SLA retainer tier.
 *
 * Upgrade (requesting silver or gold):
 *   proration_behavior = 'create_prorations' — immediate charge/credit.
 *
 * Downgrade (requesting bronze):
 *   proration_behavior = 'none' — effective at the current period end.
 *
 * Stripe price IDs per tier are read from env vars at request time:
 *   STRIPE_PRICE_ID_SLA_BRONZE / STRIPE_PRICE_ID_SLA_SILVER / STRIPE_PRICE_ID_SLA_GOLD
 */
export function registerBillingPlan(app: FastifyInstance, deps: BillingPlanRouteDeps): void {
  const { stripe } = deps;

  app.post(
    '/v1/billing/change-plan',
    {
      preHandler: requireSession,
      schema: {
        body: z.object({
          sla_tier: SlaTierEnum,
        }),
      },
    },
    async (req, reply) => {
      const { sla_tier } = req.body as { sla_tier: z.infer<typeof SlaTierEnum> };
      const tenantId = req.user!.tenantId;

      // Look up the tenant's active subscription
      const subRows = await privilegedSql<{ id: string; stripe_subscription_id: string }[]>`
        SELECT id, stripe_subscription_id
          FROM subscription
         WHERE tenant_id = ${tenantId}
           AND status IN ('active', 'trialing', 'past_due')
         ORDER BY created_at DESC
         LIMIT 1
      `;

      if (!subRows[0]) {
        const err = new Error('No active subscription found for this tenant.');
        (err as Error & { statusCode: number }).statusCode = 404;
        throw err;
      }

      const { id: dbSubId, stripe_subscription_id: stripeSubId } = subRows[0];

      // Look up the SLA subscription item
      const itemRows = await privilegedSql<{ stripe_subscription_item_id: string }[]>`
        SELECT stripe_subscription_item_id
          FROM subscription_item
         WHERE subscription_id = ${dbSubId}
           AND price_kind = 'sla'
         LIMIT 1
      `;

      if (!itemRows[0]) {
        const err = new Error('No SLA subscription item found.');
        (err as Error & { statusCode: number }).statusCode = 404;
        throw err;
      }

      const { stripe_subscription_item_id: stripeSiId } = itemRows[0];

      // Determine proration behaviour:
      //   bronze (lowest rank) → downgrade → at period end (none)
      //   silver / gold        → upgrade   → immediate (create_prorations)
      const isDowngrade = SLA_TIER_RANK[sla_tier] === SLA_TIER_RANK.bronze;
      const prorationBehavior: Stripe.SubscriptionUpdateParams.ProrationBehavior = isDowngrade
        ? 'none'
        : 'create_prorations';

      const newPriceId = process.env[SLA_TIER_PRICE_ENV[sla_tier]];

      await stripe.subscriptions.update(stripeSubId, {
        items: [
          {
            id: stripeSiId,
            ...(newPriceId ? { price: newPriceId } : {}),
          },
        ],
        proration_behavior: prorationBehavior,
      });

      return reply.code(200).send({ ok: true, sla_tier });
    },
  );
}
