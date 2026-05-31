import type { FastifyInstance } from 'fastify';
import { registerNarrativeInitial } from './narrative-initial.js';
import { registerNarrativeRegenerate } from './narrative-regenerate.js';

/**
 * Thin orchestrator that wires the two sibling narrative-route modules
 * into the Fastify app. The original monolithic narrative.ts was split
 * into focused files behind this single registration entry-point so
 * external callers (apps/api/src/app.ts) keep their existing import
 * unchanged.
 *
 *   - narrative-initial      : POST /v1/activities/:id/narrative
 *   - narrative-regenerate   : POST /v1/activities/:id/narrative/sections/
 *                              :section_kind/regenerate
 *
 * Shared Zod schemas, types, constants, and DB loaders live in
 * narrative-helpers.ts. Both routes consume the Agent C narrative
 * drafter via `streamNarrativeDraft` from `@cpa/agents/narrative-drafter`
 * — there is no module-scoped agent client singleton; the orchestrator
 * is a free function imported per request, so no state is shared
 * between the two route handlers.
 *
 * Auth: every route requires a session (requireSession) AND admin or
 * consultant role. The activity load uses RLS to filter cross-firm
 * rows automatically.
 */
export function registerNarrative(app: FastifyInstance): void {
  registerNarrativeInitial(app);
  registerNarrativeRegenerate(app);
}
