import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { z } from 'zod';
import { requireSession } from '@cpa/auth';
import {
  FOUNDER_COUPON_ID,
  tryClaimFoundingPartnerSlot,
} from '../lib/founding-partner-allocator.js';

export interface BillingRouteDeps {
  stripe: Stripe;
}

export function registerBilling(app: FastifyInstance, deps: BillingRouteDeps): void {
  const { stripe } = deps;

  app.post(
    '/v1/billing/checkout-session',
    {
      preHandler: requireSession,
      schema: {
        body: z.object({
          success_url: z.string().url(),
          cancel_url: z.string().url(),
        }),
      },
    },
    async (req, reply) => {
      const { success_url, cancel_url } = req.body as { success_url: string; cancel_url: string };
      const tenantId = req.user!.tenantId;

      // Attempt to claim a founding-partner slot (race-safe via SKIP LOCKED).
      const hasFoundingSlot = await tryClaimFoundingPartnerSlot(tenantId);

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: 'subscription',
        success_url,
        cancel_url,
        automatic_tax: { enabled: true },
        metadata: { tenant_id: tenantId },
        line_items: [
          // Onboarding fee — one-time charge at conversion.
          ...(process.env['STRIPE_PRICE_ID_ONBOARDING']
            ? [{ price: process.env['STRIPE_PRICE_ID_ONBOARDING'], quantity: 1 }]
            : []),
          // Per-claim metered usage record subscription item.
          ...(process.env['STRIPE_PRICE_ID_PER_CLAIM']
            ? [{ price: process.env['STRIPE_PRICE_ID_PER_CLAIM'] }]
            : []),
          // Mobile subscriber seat (quantity synced separately by Task 1.10).
          ...(process.env['STRIPE_PRICE_ID_MOBILE']
            ? [{ price: process.env['STRIPE_PRICE_ID_MOBILE'], quantity: 0 }]
            : []),
          // Quarterly SLA fee (Bronze tier default at checkout).
          ...(process.env['STRIPE_PRICE_ID_SLA']
            ? [{ price: process.env['STRIPE_PRICE_ID_SLA'], quantity: 1 }]
            : []),
        ],
        ...(hasFoundingSlot ? { discounts: [{ coupon: FOUNDER_COUPON_ID }] } : {}),
      };

      const session = await stripe.checkout.sessions.create(sessionParams);

      return reply.code(200).send({ checkout_url: session.url });
    },
  );
}
