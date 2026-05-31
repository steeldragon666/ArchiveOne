import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { insertEventWithChain } from '@cpa/db';
import { type ClaimsRouteDeps } from './claims-shared.js';

/**
 * Register the allocation-review + auto-allocator routes for a claim.
 * These power the consultant-portal review queue (pending suggestions,
 * confirm/reject, batch-confirm) and the on-demand auto-allocator.
 */
export function registerClaimsAllocations(app: FastifyInstance, _deps?: ClaimsRouteDeps): void {
  // -----------------------------------------------------------------------
  // GET /v1/claims/:id/preflight
  // Pre-flight check before allowing Submit Claim.
  // Returns { ok, issues[], activity_count, activities_without_hypothesis,
  //           unlinked_evidence_count, has_expenditure }
  // -----------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id/preflight',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;

      const result = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        // Claim must exist and belong to this tenant.
        const claimRows = await tx<{ id: string; stage: string }[]>`
          SELECT id, stage FROM claim WHERE id = ${id} AND tenant_id = ${tenantId}
        `;
        if (!claimRows[0]) return null;

        // Activity count + hypothesis completeness.
        const activityRows = await tx<{ id: string; hypothesis: string | null }[]>`
          SELECT id, hypothesis FROM activity WHERE claim_id = ${id}
        `;
        const activity_count = activityRows.length;
        const activities_without_hypothesis = activityRows.filter(
          (a) => !a.hypothesis || a.hypothesis.trim().length === 0,
        ).length;

        // Evidence linked to any activity in this claim.
        const linkedRows = await tx<{ n: string }[]>`
          SELECT COUNT(*)::text AS n
            FROM event e
           WHERE e.tenant_id = ${tenantId}
             AND e.kind = 'ARTEFACT_LINKED'
             AND e.payload->>'activity_id' IN (
               SELECT id::text FROM activity WHERE claim_id = ${id}
             )
        `;
        const linked_evidence_count = parseInt(linkedRows[0]?.n ?? '0', 10);

        // Total classified evidence for this claim's subject_tenant.
        const subjectRows = await tx<{ subject_tenant_id: string }[]>`
          SELECT subject_tenant_id FROM claim WHERE id = ${id}
        `;
        const subject_tenant_id = subjectRows[0]?.subject_tenant_id;
        let total_classified_events = 0;
        if (subject_tenant_id) {
          const totalRows = await tx<{ n: string }[]>`
            SELECT COUNT(*)::text AS n
              FROM event
             WHERE subject_tenant_id = ${subject_tenant_id}
               AND classification IS NOT NULL
               AND kind NOT IN ('OVERRIDE', 'ARTEFACT_LINKED', 'ARTEFACT_UNLINKED')
          `;
          total_classified_events = parseInt(totalRows[0]?.n ?? '0', 10);
        }
        const unlinked_evidence_count = Math.max(
          0,
          total_classified_events - linked_evidence_count,
        );

        // Expenditure summary.
        const expendRows = await tx<{ n: string }[]>`
          SELECT COUNT(*)::text AS n
            FROM expenditure
           WHERE claim_id = ${id}
             AND tenant_id = ${tenantId}
        `;
        const has_expenditure = parseInt(expendRows[0]?.n ?? '0', 10) > 0;

        return {
          activity_count,
          activities_without_hypothesis,
          unlinked_evidence_count,
          has_expenditure,
        };
      });

      if (!result) {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }

      const issues: string[] = [];
      if (result.activity_count === 0) {
        issues.push('No activities registered for this claim.');
      }
      if (result.activities_without_hypothesis > 0) {
        issues.push(
          `${result.activities_without_hypothesis} ${result.activities_without_hypothesis === 1 ? 'activity is' : 'activities are'} missing a hypothesis.`,
        );
      }
      if (!result.has_expenditure) {
        issues.push('No expenditure records found — add at least one before submitting.');
      }

      return reply.status(200).send({
        ok: issues.length === 0,
        issues,
        ...result,
      });
    },
  );

  // -----------------------------------------------------------------------
  // GET /v1/claims/:id/pending-review
  // Returns events with suggestion_status = 'pending' (or un-allocated but
  // classified evidence) for the consultant review queue.
  // -----------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id/pending-review',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;

      return await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        // Resolve subject_tenant_id for this claim.
        const claimRows = await tx<{ subject_tenant_id: string }[]>`
          SELECT subject_tenant_id FROM claim WHERE id = ${id} AND tenant_id = ${tenantId}
        `;
        if (!claimRows[0]) {
          return reply.status(404).send({
            error: 'claim_not_found',
            message: 'No claim with that id in this firm',
            requestId: req.id,
          });
        }
        const { subject_tenant_id } = claimRows[0];

        // All activities for this claim (for joining suggestion details).
        const activityRows = await tx<{ id: string; code: string; title: string }[]>`
          SELECT id, code, title FROM activity WHERE claim_id = ${id}
        `;
        const activityMap = new Map(activityRows.map((a) => [a.id, a]));

        // Events with a suggestion (any status) OR classified events with no suggestion yet.
        const eventRows = await tx<
          {
            id: string;
            kind: string;
            effective_kind: string;
            payload: unknown;
            classification: unknown;
            suggested_activity_id: string | null;
            suggested_at: string | null;
            suggestion_confidence: string | null;
            suggestion_status: string | null;
            captured_at: string;
          }[]
        >`
          SELECT e.id,
                 e.kind,
                 e.kind AS effective_kind,
                 e.payload,
                 e.classification,
                 e.suggested_activity_id,
                 e.suggested_at::text,
                 e.suggestion_confidence,
                 e.suggestion_status,
                 e.captured_at::text
            FROM event e
           WHERE e.subject_tenant_id = ${subject_tenant_id}
             AND e.tenant_id = ${tenantId}
             AND e.classification IS NOT NULL
             AND e.kind NOT IN (
               'OVERRIDE', 'ARTEFACT_LINKED', 'ARTEFACT_UNLINKED',
               'CLAIM_STAGE_ADVANCED', 'CLAIM_SUBMITTED', 'ACTIVITY_CREATED',
               'ACTIVITY_UPDATED', 'ACTIVITY_LOCKED'
             )
           ORDER BY e.captured_at DESC
           LIMIT 200
        `;

        const events = eventRows.map((row) => {
          const suggestedActivity = row.suggested_activity_id
            ? activityMap.get(row.suggested_activity_id)
            : null;
          return {
            id: row.id,
            kind: row.kind,
            effective_kind: row.effective_kind,
            payload: row.payload,
            classification: row.classification,
            suggested_activity_id: row.suggested_activity_id,
            suggested_at: row.suggested_at,
            suggestion_confidence: row.suggestion_confidence
              ? parseFloat(row.suggestion_confidence)
              : null,
            suggestion_status: row.suggestion_status,
            captured_at: row.captured_at,
            suggested_activity_code: suggestedActivity?.code ?? null,
            suggested_activity_title: suggestedActivity?.title ?? null,
          };
        });

        // Status counters.
        const pending_count = events.filter((e) => e.suggestion_status === 'pending').length;
        const confirmed_count = events.filter((e) => e.suggestion_status === 'confirmed').length;
        const rejected_count = events.filter((e) => e.suggestion_status === 'rejected').length;
        const edited_count = events.filter((e) => e.suggestion_status === 'edited').length;

        return reply.status(200).send({
          events,
          total_in_claim: events.length,
          pending_count,
          confirmed_count,
          rejected_count,
          edited_count,
        });
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /v1/claims/:id/events/:event_id/confirm-allocation
  // Marks suggestion_status='confirmed' + creates artefact-link.
  // -----------------------------------------------------------------------
  app.post<{ Params: { id: string; event_id: string } }>(
    '/v1/claims/:id/events/:event_id/confirm-allocation',
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

      const { id: claimId, event_id: eventId } = req.params;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;

      // Load the event + suggestion + claim context.
      const guard = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        const eventRows = await tx<
          {
            id: string;
            subject_tenant_id: string;
            suggested_activity_id: string | null;
            suggestion_status: string | null;
          }[]
        >`
          SELECT e.id, e.subject_tenant_id, e.suggested_activity_id, e.suggestion_status
            FROM event e
           WHERE e.id = ${eventId}
             AND e.tenant_id = ${tenantId}
        `;
        const evt = eventRows[0];
        if (!evt) return { kind: 'event_not_found' as const };
        if (!evt.suggested_activity_id) return { kind: 'no_suggestion' as const };

        const activityRows = await tx<{ id: string; project_id: string }[]>`
          SELECT a.id, a.project_id
            FROM activity a
            JOIN claim c ON c.id = a.claim_id
           WHERE a.id = ${evt.suggested_activity_id}
             AND a.tenant_id = ${tenantId}
             AND c.id = ${claimId}
        `;
        const activity = activityRows[0];
        if (!activity) return { kind: 'activity_not_found' as const };

        return {
          kind: 'ok' as const,
          subject_tenant_id: evt.subject_tenant_id,
          activity_id: activity.id,
          project_id: activity.project_id,
        };
      });

      if (guard.kind === 'event_not_found') {
        return reply
          .status(404)
          .send({ error: 'event_not_found', message: 'Event not found', requestId: req.id });
      }
      if (guard.kind === 'no_suggestion') {
        return reply.status(422).send({
          error: 'no_suggestion',
          message: 'Event has no pending suggestion',
          requestId: req.id,
        });
      }
      if (guard.kind === 'activity_not_found') {
        return reply.status(404).send({
          error: 'activity_not_found',
          message: 'Suggested activity not found in this claim',
          requestId: req.id,
        });
      }

      // Mark confirmed.
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        await tx`
          UPDATE event
             SET suggestion_status = 'confirmed'
           WHERE id = ${eventId} AND tenant_id = ${tenantId}
        `;
      });

      // Create the artefact-link chain event.
      const inserted = await insertEventWithChain({
        tenant_id: tenantId,
        subject_tenant_id: guard.subject_tenant_id,
        project_id: guard.project_id,
        kind: 'ARTEFACT_LINKED',
        payload: {
          activity_id: guard.activity_id,
          artefact_kind: 'event',
          artefact_id: eventId,
          link_reason: 'auto-allocation confirmed by consultant',
        },
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
      });

      return reply.status(200).send({
        event_id: eventId,
        suggestion_status: 'confirmed',
        link_event_id: inserted.id,
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /v1/claims/:id/events/:event_id/reject-allocation
  // Marks suggestion_status='rejected'. No artefact-link created.
  // -----------------------------------------------------------------------
  app.post<{ Params: { id: string; event_id: string } }>(
    '/v1/claims/:id/events/:event_id/reject-allocation',
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

      const { id: claimId, event_id: eventId } = req.params;
      const tenantId = req.user!.tenantId!;

      const exists = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ id: string }[]>`
          SELECT e.id FROM event e
           JOIN claim c ON c.subject_tenant_id = e.subject_tenant_id
           WHERE e.id = ${eventId} AND e.tenant_id = ${tenantId} AND c.id = ${claimId}
        `;
        return rows[0] != null;
      });

      if (!exists) {
        return reply.status(404).send({
          error: 'event_not_found',
          message: 'Event not found in this claim',
          requestId: req.id,
        });
      }

      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        await tx`
          UPDATE event
             SET suggestion_status = 'rejected'
           WHERE id = ${eventId} AND tenant_id = ${tenantId}
        `;
      });

      return reply.status(200).send({ event_id: eventId, suggestion_status: 'rejected' });
    },
  );

  // -----------------------------------------------------------------------
  // POST /v1/claims/:id/batch-confirm-allocations
  // Confirm multiple suggestions at once.
  // body: { event_ids: string[] }
  // -----------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/claims/:id/batch-confirm-allocations',
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

      const bodyParsed = z
        .object({ event_ids: z.array(z.string().uuid()).min(1).max(100) })
        .safeParse(req.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: 'Body must be { event_ids: uuid[] }',
          requestId: req.id,
        });
      }
      const { event_ids } = bodyParsed.data;
      const { id: claimId } = req.params;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;

      let confirmed = 0;
      let failed = 0;

      for (const eventId of event_ids) {
        try {
          const guard = await sql.begin(async (tx) => {
            await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
            const rows = await tx<
              {
                subject_tenant_id: string;
                suggested_activity_id: string | null;
                project_id: string | null;
              }[]
            >`
              SELECT e.subject_tenant_id,
                     e.suggested_activity_id,
                     a.project_id
                FROM event e
                LEFT JOIN activity a ON a.id = e.suggested_activity_id
               WHERE e.id = ${eventId}
                 AND e.tenant_id = ${tenantId}
                 AND EXISTS (
                   SELECT 1 FROM claim c
                    WHERE c.id = ${claimId}
                      AND c.subject_tenant_id = e.subject_tenant_id
                 )
            `;
            return rows[0] ?? null;
          });

          if (!guard?.suggested_activity_id) {
            failed++;
            continue;
          }

          await sql.begin(async (tx) => {
            await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
            await tx`UPDATE event SET suggestion_status = 'confirmed' WHERE id = ${eventId} AND tenant_id = ${tenantId}`;
          });

          await insertEventWithChain({
            tenant_id: tenantId,
            subject_tenant_id: guard.subject_tenant_id,
            project_id: guard.project_id ?? null,
            kind: 'ARTEFACT_LINKED',
            payload: {
              activity_id: guard.suggested_activity_id,
              artefact_kind: 'event',
              artefact_id: eventId,
              link_reason: 'auto-allocation batch confirmed',
            },
            classification: null,
            captured_at: new Date(),
            captured_by_user_id: userId,
            override_of_event_id: null,
            override_new_kind: null,
            override_reason: null,
          });

          confirmed++;
        } catch {
          failed++;
        }
      }

      return reply.status(200).send({ confirmed, failed });
    },
  );

  // -----------------------------------------------------------------------
  // POST /v1/claims/:id/auto-allocate-batch
  // Run the auto-allocator on all unallocated classified events for a claim.
  // -----------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/claims/:id/auto-allocate-batch',
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

      const { id: claimId } = req.params;
      const tenantId = req.user!.tenantId!;

      // Resolve subject_tenant_id.
      const claimRow = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ subject_tenant_id: string }[]>`
          SELECT subject_tenant_id FROM claim WHERE id = ${claimId} AND tenant_id = ${tenantId}
        `;
        return rows[0] ?? null;
      });

      if (!claimRow) {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }

      // Load activities.
      const activities = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return tx<
          { id: string; code: string; kind: string; title: string; hypothesis: string | null }[]
        >`
          SELECT id, code, kind, title, hypothesis
            FROM activity
           WHERE claim_id = ${claimId}
             AND tenant_id = ${tenantId}
           ORDER BY code ASC
        `;
      });

      // Load unallocated classified events (suggestion_status IS NULL means not yet run).
      const unallocatedEvents = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return tx<{ id: string; kind: string; payload: unknown; classification: unknown }[]>`
          SELECT id, kind, payload, classification
            FROM event
           WHERE subject_tenant_id = ${claimRow.subject_tenant_id}
             AND tenant_id = ${tenantId}
             AND classification IS NOT NULL
             AND suggestion_status IS NULL
             AND kind NOT IN (
               'OVERRIDE', 'ARTEFACT_LINKED', 'ARTEFACT_UNLINKED',
               'CLAIM_STAGE_ADVANCED', 'CLAIM_SUBMITTED', 'ACTIVITY_CREATED',
               'ACTIVITY_UPDATED', 'ACTIVITY_LOCKED'
             )
           LIMIT 50
        `;
      });

      // Lazy allocator.
      const { makeAutoAllocator } = await import('@cpa/agents');
      const allocator = makeAutoAllocator();

      const suggestions = [];
      let suggested = 0;
      let unallocated_count = 0;

      for (const evt of unallocatedEvents) {
        const classification = evt.classification as {
          kind: string;
          confidence: number;
          rationale: string;
          statutory_anchor: string | null;
        } | null;
        if (!classification) continue;

        const payload = evt.payload as Record<string, unknown> | null;
        const raw_text =
          typeof payload?.raw_text === 'string'
            ? payload.raw_text
            : typeof payload?.transcript === 'string'
              ? payload.transcript
              : evt.kind;

        try {
          const suggestion = await allocator.allocate({
            event_id: evt.id,
            raw_text,
            classification: classification as Parameters<
              typeof allocator.allocate
            >[0]['classification'],
            activities: activities.map((a) => ({
              id: a.id,
              code: a.code,
              kind: a.kind as 'core' | 'supporting',
              title: a.title,
              hypothesis: a.hypothesis,
            })),
          });

          // Persist.
          await sql.begin(async (tx) => {
            await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
            if (!suggestion.unallocated) {
              await tx`
                UPDATE event
                   SET suggested_activity_id  = ${suggestion.activity_id}::uuid,
                       suggested_at           = NOW(),
                       suggestion_confidence  = ${String(suggestion.confidence)},
                       suggestion_status      = 'pending'
                 WHERE id = ${evt.id} AND tenant_id = ${tenantId}
              `;
              suggested++;
            } else {
              await tx`
                UPDATE event
                   SET suggested_activity_id  = NULL,
                       suggested_at           = NOW(),
                       suggestion_confidence  = NULL,
                       suggestion_status      = 'pending'
                 WHERE id = ${evt.id} AND tenant_id = ${tenantId}
              `;
              unallocated_count++;
            }
          });

          suggestions.push({
            event_id: evt.id,
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
        } catch (err) {
          app.log.error({ err, event_id: evt.id }, 'auto-allocate batch: event failed');
        }
      }

      return reply.status(200).send({
        suggestions,
        total: unallocatedEvents.length,
        suggested,
        unallocated: unallocated_count,
      });
    },
  );
}
