import type { FastifyInstance } from 'fastify';
import { registerClaimsCrud } from './claims-crud.js';
import { registerClaimsDelivery } from './claims-delivery.js';
import { registerClaimsAllocations } from './claims-allocations.js';
import { registerClaimsFinalisation } from './claims-finalisation.js';
import type { ClaimsRouteDeps } from './claims-shared.js';

export type { ClaimsRouteDeps } from './claims-shared.js';

/**
 * Thin orchestrator that wires the four sibling claim-route modules into
 * the Fastify app. The original monolithic claims.ts was split into
 * focused files behind this single registration entry-point so external
 * callers (apps/api/src/app.ts) keep their existing import unchanged.
 *
 *   - claims-crud           : POST/GET/PATCH on the claim resource +
 *                             stage-advance event chain
 *   - claims-delivery       : PATCH /:id/deliver (Stripe usage record)
 *   - claims-allocations    : preflight, pending-review, confirm / reject
 *                             / batch-confirm / auto-allocate-batch
 *   - claims-finalisation   : finalise + gates + status + final-draft
 *
 * Each sub-register is independent — no cross-file imports beyond the
 * shared types in claims-shared.ts.
 */
export function registerClaims(app: FastifyInstance, deps?: ClaimsRouteDeps): void {
  registerClaimsCrud(app, deps);
  registerClaimsDelivery(app, deps);
  registerClaimsAllocations(app, deps);
  registerClaimsFinalisation(app, deps);
}
