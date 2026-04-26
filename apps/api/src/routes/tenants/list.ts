import type { FastifyInstance } from 'fastify';
import { lookupActiveTenant, requireSession } from '@cpa/auth';

/**
 * Register GET /v1/tenants — returns the user's active firm + full
 * membership list.
 *
 * Re-queries via lookupActiveTenant (privileged DB) so the response
 * reflects current membership state, not the cookie's potentially-stale
 * availableTenants claim. Useful for the consultant portal's tenant
 * switcher: it can show fresh role/isDefault values immediately after
 * an admin updates them in another tab.
 *
 * preHandler: requireSession (must be logged in AND have an active firm).
 * Users with zero memberships hit the 403 in requireSession before
 * reaching here.
 */
export function registerListTenants(app: FastifyInstance): void {
  app.get('/v1/tenants', { preHandler: requireSession }, async (req) => {
    const active = await lookupActiveTenant(req.user!.id);
    return {
      activeTenantId: active.activeTenantId,
      availableTenants: active.availableTenants,
    };
  });
}
