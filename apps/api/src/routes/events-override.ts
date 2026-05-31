import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { insertEventWithChain } from '@cpa/db';
import { sql } from '@cpa/db/client';
import { overrideEventBody } from '@cpa/schemas';
import { rowToEvent, type RawEventViewRow } from './events-shared.js';

/**
 * Register the override route:
 *   - POST /v1/events/:id/override — append an OVERRIDE event to the chain
 *
 * Auth: requireSession; per-claimant ACL enforced via RLS on the subject_tenant
 * lookup. Override-of-override is rejected with a 400 so callers don't have to
 * decode the DB CHECK error.
 */
export function registerEventsOverride(app: FastifyInstance): void {
  app.post<{ Params: { id: string } }>(
    '/v1/events/:id/override',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id } = req.params;
      const parsed = overrideEventBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: 'Body must be { new_kind: ClassifiableKind, reason: string }',
          requestId: req.id,
        });
      }
      const { new_kind, reason } = parsed.data;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;

      // Step 1: load the original under RLS. 404 covers missing + cross-firm.
      const original = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ id: string; kind: string; subject_tenant_id: string }[]>`
          SELECT id, kind, subject_tenant_id FROM event WHERE id = ${id}
        `;
        return rows[0] ?? null;
      });
      if (!original) {
        return reply.status(404).send({
          error: 'event_not_found',
          message: 'No event with that id in this firm',
          requestId: req.id,
        });
      }

      // Step 2: reject override-of-override. The DB CHECK on event would
      // ALSO reject this (override_invariants requires override_of_event_id
      // to point at a non-OVERRIDE row by convention), but we surface a
      // clean 400 with a domain message rather than a generic 500.
      if (original.kind === 'OVERRIDE') {
        return reply.status(400).send({
          error: 'override_of_override',
          message: 'Cannot override an OVERRIDE event; override the original instead',
          requestId: req.id,
        });
      }

      // Step 3: append a new OVERRIDE event to the chain. The chain helper's
      // canonicalisation includes override_of_event_id / override_new_kind /
      // override_reason so the OVERRIDE row's hash captures the reviewer's
      // decision. idempotency_key=null because OVERRIDE events aren't
      // content-addressed (every override is a deliberate distinct action).
      const inserted = await insertEventWithChain({
        tenant_id: tenantId,
        subject_tenant_id: original.subject_tenant_id,
        kind: 'OVERRIDE',
        payload: { _v: 1, source: 'override', original_event_id: original.id },
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: original.id,
        override_new_kind: new_kind,
        override_reason: reason,
        idempotency_key: null,
      });

      // Step 4: read back via the view (effective_kind / is_overridden).
      const fresh = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<RawEventViewRow[]>`
          SELECT * FROM event_with_effective_kind WHERE id = ${inserted.id}
        `;
        return rows[0];
      });
      if (!fresh) {
        throw new Error('POST /v1/events/:id/override: inserted row not visible via view');
      }

      return reply.status(201).send({ override_event: rowToEvent(fresh) });
    },
  );
}
