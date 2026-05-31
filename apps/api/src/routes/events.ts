import type { FastifyInstance } from 'fastify';
import { registerEventsCrud } from './events-crud.js';
import { registerEventsOverride } from './events-override.js';
import { registerEventsExtraction } from './events-extraction.js';
import { registerEventsProposed } from './events-proposed.js';
import { registerEventsSuggestion } from './events-suggestion.js';

/**
 * Thin orchestrator that wires the five sibling event-route modules into
 * the Fastify app. The original monolithic events.ts was split into
 * focused files behind this single registration entry-point so external
 * callers (apps/api/src/app.ts) keep their existing import unchanged.
 *
 *   - events-crud         : POST /v1/events, GET /v1/events
 *   - events-override     : POST /v1/events/:id/override
 *   - events-extraction   : GET /v1/events/:id/extraction +
 *                           POST /v1/events/:id/extract-content
 *   - events-proposed     : POST /v1/proposed-activities/:event_id/accept +
 *                           POST /v1/proposed-invoices/:event_id/accept
 *   - events-suggestion   : POST /v1/events/:id/suggest-allocation
 *
 * Shared row shapes + the toApi projector live in events-shared.ts;
 * file-scoped helpers (classifier/allocator singletons, cursor codec)
 * live in the file that uses them.
 *
 * Auth: every route requires a session (requireSession). Per-claimant ACL
 * checks are deferred to RLS — the subject_tenant table's policy filters
 * cross-firm rows automatically.
 */
export function registerEvents(app: FastifyInstance): void {
  registerEventsCrud(app);
  registerEventsOverride(app);
  registerEventsExtraction(app);
  registerEventsProposed(app);
  registerEventsSuggestion(app);
}
