import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { makeAutoAllocator, type AutoAllocator } from '@cpa/agents';
import { sql } from '@cpa/db/client';
import type { Classification } from '@cpa/schemas';

// Lazy auto-allocator singleton — same rationale as the classifier in
// events-crud.ts: defer construction so a misconfigured ANTHROPIC_API_KEY
// surfaces as a per-request 503 rather than a process-wide boot failure,
// and so the test runner can swap implementations between import time
// and the first request.
let allocatorInstance: AutoAllocator | null = null;
const getAllocator = (): AutoAllocator => {
  if (!allocatorInstance) allocatorInstance = makeAutoAllocator();
  return allocatorInstance;
};

/**
 * Register the auto-allocation suggestion route:
 *   - POST /v1/events/:id/suggest-allocation — run the allocator, persist
 *     the suggestion columns (no chain event — suggestions are workflow
 *     metadata, not part of the canonical claim chain).
 *
 * Auth: requireSession; RLS scopes the event lookup to the firm's tenant.
 */
export function registerEventsSuggestion(app: FastifyInstance): void {
  // -----------------------------------------------------------------------
  // POST /v1/events/:id/suggest-allocation
  // Runs the auto-allocator on a single event + returns the suggestion.
  // Does NOT mutate; suggestion is stored ephemerally until confirmed.
  // -----------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/events/:id/suggest-allocation',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;

      // 1. Load the event with its classification.
      const eventRow = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<
          {
            id: string;
            subject_tenant_id: string;
            kind: string;
            payload: unknown;
            classification: unknown;
          }[]
        >`
          SELECT id, subject_tenant_id, kind, payload, classification
            FROM event
           WHERE id = ${id}
             AND tenant_id = ${tenantId}
        `;
        return rows[0] ?? null;
      });

      if (!eventRow) {
        return reply.status(404).send({
          error: 'event_not_found',
          message: 'No event with that id in this firm',
          requestId: req.id,
        });
      }

      const classification = eventRow.classification as Classification | null;
      if (!classification) {
        return reply.status(422).send({
          error: 'not_classified',
          message: 'Event has no classification; classify before allocating',
          requestId: req.id,
        });
      }

      // 2. Resolve claim + activities for this event's subject_tenant.
      const activities = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        // Find the most-recent open claim for this subject_tenant.
        const rows = await tx<
          {
            id: string;
            code: string;
            kind: string;
            title: string;
            hypothesis: string | null;
          }[]
        >`
          SELECT a.id, a.code, a.kind, a.title, a.hypothesis
            FROM activity a
            JOIN claim c ON c.id = a.claim_id
           WHERE c.subject_tenant_id = ${eventRow.subject_tenant_id}
             AND a.tenant_id = ${tenantId}
             AND c.stage NOT IN ('submitted', 'audit_defence')
           ORDER BY c.fiscal_year DESC, a.code ASC
        `;
        return rows;
      });

      // 3. Extract raw_text from payload.
      const payload = eventRow.payload as Record<string, unknown> | null;
      const raw_text =
        typeof payload?.raw_text === 'string'
          ? payload.raw_text
          : typeof payload?.transcript === 'string'
            ? payload.transcript
            : eventRow.kind;

      // 4. Run allocator.
      const suggestion = await getAllocator().allocate({
        event_id: id,
        raw_text,
        classification,
        activities: activities.map((a) => ({
          id: a.id,
          code: a.code,
          kind: a.kind as 'core' | 'supporting',
          title: a.title,
          hypothesis: a.hypothesis,
        })),
      });

      // 5. Persist suggestion columns (no chain event — suggestions are workflow metadata).
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        if (!suggestion.unallocated) {
          await tx`
            UPDATE event
               SET suggested_activity_id  = ${suggestion.activity_id}::uuid,
                   suggested_at           = NOW(),
                   suggestion_confidence  = ${String(suggestion.confidence)},
                   suggestion_status      = 'pending'
             WHERE id        = ${id}
               AND tenant_id = ${tenantId}
          `;
        } else {
          // Still mark as "ran through allocator but no match".
          await tx`
            UPDATE event
               SET suggested_activity_id  = NULL,
                   suggested_at           = NOW(),
                   suggestion_confidence  = NULL,
                   suggestion_status      = 'pending'
             WHERE id        = ${id}
               AND tenant_id = ${tenantId}
          `;
        }
      });

      return reply.status(200).send({
        event_id: id,
        suggestion: suggestion.unallocated
          ? {
              unallocated: true,
              activity_id: null,
              activity_code: null,
              confidence: null,
              rationale: suggestion.rationale,
            }
          : {
              unallocated: false,
              activity_id: suggestion.activity_id,
              activity_code: suggestion.activity_code,
              confidence: suggestion.confidence,
              rationale: suggestion.rationale,
            },
      });
    },
  );
}
