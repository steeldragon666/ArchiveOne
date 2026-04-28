import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { insertEventWithChain } from '@cpa/db';
import {
  ArtefactLinkedPayload,
  ArtefactUnlinkedPayload,
  CreateArtefactLinkBody,
  UnlinkArtefactBody,
} from '@cpa/schemas';
import { findLinkedEventForActivity } from '../lib/activity-artefacts.js';

// TODO(p4-a-cleanup): post-A1 review-flagged refactors deferred to a separate
// cross-cutting task after the swimlanes merge — same items affect this file:
//
//   1. Event-write (`insertEventWithChain`) runs AFTER the row-mutation
//      transaction commits. Here that means the activity-existence check
//      inside `sql.begin` lands first, and a chain-write failure between
//      the two awaits leaves no event but a successful precondition pass.
//      Fix: extend `insertEventWithChain` to accept an optional `tx`
//      parameter so callers compose precondition+event in one tx.
//      Affects all routes that emit chain events.
//      See: A1 quality review 2026-04-28, Important #3.
//
//   2. The artefact-existence switch (per artefact_kind) lives inside the
//      `sql.begin` callback in POST. A future refactor could replace this
//      with a SQL function that takes (kind, id, tenant_id) and returns
//      bool, hiding the table list at the DB layer; for now we keep the
//      switch inline because postgres-js's `TransactionSql` type isn't
//      reachable from apps/api without pulling postgres in as a direct
//      dep, and a structurally-typed wrapper drifts from the actual
//      callback shape (helper-thenable vs Promise). Worth doing once the
//      uncertainty register (A6) needs the same lookup.

/**
 * Register the activity artefact-link routes (T-A4 of the P4 plan).
 *
 * The link/unlink pair drives the consultant-facing "Linked evidence"
 * panel on the activity detail view. Both routes are append-only: a
 * link writes ARTEFACT_LINKED, an unlink writes ARTEFACT_UNLINKED with
 * the same artefact_id; the original LINKED event is NEVER deleted.
 * The materialised "currently linked artefacts" list is computed by
 * {@link getActivityArtefacts} (folding LINKED minus UNLINKED in
 * captured_at order).
 *
 * Auth: requireSession + admin-or-consultant gating on both routes.
 *   - Viewers can list/detail but cannot link or unlink.
 *
 * RLS: every read/write inside `sql.begin` sets `app.current_tenant_id`.
 * Cross-firm 404 is enforced two ways:
 *   - Activity lookup uses RLS + `AND tenant_id = ${tenantId}`
 *     (defense-in-depth, same pattern as A3 PATCH).
 *   - Artefact existence check (one of `media_artefact` / `event` /
 *     `expenditure` / `time_entry`) is RLS-scoped AND has an explicit
 *     `AND tenant_id = ${tenantId}` clause — so a mis-set GUC can't
 *     leak cross-firm artefact_ids.
 *
 * Stage gating: a 'submitted' or 'audit_defence' parent claim freezes
 * artefact links — neither POST nor DELETE may write. Consultants must
 * edit before the claim hits a terminal stage (same gate as A3 PATCH).
 *
 * Event chain: each mutation extends the per-claimant hash chain via
 * `insertEventWithChain`. The helper holds a per-subject_tenant
 * advisory lock so concurrent mutations on the same chain serialise.
 */
export function registerArtefactLinks(app: FastifyInstance): void {
  // ---------------------------------------------------------------------
  // POST /v1/activities/:activity_id/artefact-links
  // body: { artefact_kind, artefact_id, link_reason? }
  // ---------------------------------------------------------------------
  app.post<{ Params: { activity_id: string } }>(
    '/v1/activities/:activity_id/artefact-links',
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

      const parsed = CreateArtefactLinkBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid_body',
          message:
            'Body must be { artefact_kind: "media" | "event" | "expenditure" | "time_entry", artefact_id, link_reason? }',
          requestId: req.id,
        });
      }
      const { artefact_kind, artefact_id, link_reason } = parsed.data;
      const { activity_id } = req.params;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;

      // Resolve the activity + parent claim stage + subject_tenant in
      // one tx. Same pattern as A3 PATCH — defends against a racing
      // submit/audit-defence transition between activity-lookup and
      // event-write.
      const guard = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const activityRows = await tx<
          {
            id: string;
            project_id: string;
            subject_tenant_id: string;
            claim_stage: string;
          }[]
        >`
          SELECT a.id, a.project_id,
                 c.stage AS claim_stage,
                 c.subject_tenant_id AS subject_tenant_id
            FROM activity a
            JOIN claim c ON c.id = a.claim_id
           WHERE a.id = ${activity_id}
             AND a.tenant_id = ${tenantId}
        `;
        const activity = activityRows[0];
        if (!activity) return { kind: 'activity_not_found' as const };
        if (activity.claim_stage === 'submitted' || activity.claim_stage === 'audit_defence') {
          return { kind: 'claim_locked' as const, stage: activity.claim_stage };
        }
        // Cross-tenant artefact existence check. RLS already filters
        // cross-firm rows; the explicit `AND tenant_id` is
        // defense-in-depth (matches A3's pattern). Inlined per-kind
        // because postgres-js's `TransactionSql` type isn't reachable
        // from apps/api as a callable shape — see the file-top TODO
        // for the planned refactor.
        let artefactExists = false;
        if (artefact_kind === 'media') {
          const rows = await tx<{ id: string }[]>`
            SELECT id FROM media_artefact
             WHERE id = ${artefact_id}
               AND tenant_id = ${tenantId}
          `;
          artefactExists = rows.length > 0;
        } else if (artefact_kind === 'event') {
          const rows = await tx<{ id: string }[]>`
            SELECT id FROM event
             WHERE id = ${artefact_id}
               AND tenant_id = ${tenantId}
          `;
          artefactExists = rows.length > 0;
        } else if (artefact_kind === 'expenditure') {
          const rows = await tx<{ id: string }[]>`
            SELECT id FROM expenditure
             WHERE id = ${artefact_id}
               AND tenant_id = ${tenantId}
          `;
          artefactExists = rows.length > 0;
        } else if (artefact_kind === 'time_entry') {
          const rows = await tx<{ id: string }[]>`
            SELECT id FROM time_entry
             WHERE id = ${artefact_id}
               AND tenant_id = ${tenantId}
          `;
          artefactExists = rows.length > 0;
        } else {
          // Exhaustiveness — TS errors at this assignment if the
          // ArtefactKind enum ever grows without a matching branch above.
          const _exhaustive: never = artefact_kind;
          void _exhaustive;
        }
        if (!artefactExists) return { kind: 'artefact_not_found' as const };

        return {
          kind: 'ok' as const,
          project_id: activity.project_id,
          subject_tenant_id: activity.subject_tenant_id,
        };
      });

      if (guard.kind === 'activity_not_found') {
        return reply.status(404).send({
          error: 'activity_not_found',
          message: 'No activity with that id in this firm',
          requestId: req.id,
        });
      }
      if (guard.kind === 'claim_locked') {
        return reply.status(409).send({
          error: 'claim_locked',
          message: `Cannot link artefacts to an activity on a claim in stage "${guard.stage}"`,
          requestId: req.id,
        });
      }
      if (guard.kind === 'artefact_not_found') {
        return reply.status(404).send({
          error: 'artefact_not_found',
          message: `No ${artefact_kind} artefact with that id in this firm`,
          kind: artefact_kind,
          artefact_id,
          requestId: req.id,
        });
      }

      // Zod-parse the payload at the boundary — same rationale as the
      // other A-swimlane routes: a future refactor that drifts the
      // payload shape blows up here (programming error) rather than
      // landing a malformed event on the chain.
      const linkedPayload = ArtefactLinkedPayload.parse({
        activity_id,
        artefact_kind,
        artefact_id,
        ...(link_reason !== undefined ? { link_reason } : {}),
      });
      const inserted = await insertEventWithChain({
        tenant_id: tenantId,
        subject_tenant_id: guard.subject_tenant_id,
        project_id: guard.project_id,
        kind: 'ARTEFACT_LINKED',
        payload: linkedPayload,
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
      });

      return reply.status(201).send({
        event_id: inserted.id,
        activity_id,
        artefact_kind,
        artefact_id,
        link_reason: link_reason ?? null,
      });
    },
  );

  // ---------------------------------------------------------------------
  // DELETE /v1/activities/:activity_id/artefact-links/:event_id
  // optional body: { reason? }
  // ---------------------------------------------------------------------
  app.delete<{ Params: { activity_id: string; event_id: string } }>(
    '/v1/activities/:activity_id/artefact-links/:event_id',
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

      // Optional body — same pattern as DELETE /v1/projects/:id (A1).
      // Empty body / no body is fine.
      let reason: string | undefined;
      if (req.body !== undefined && req.body !== null) {
        const parsed = UnlinkArtefactBody.safeParse(req.body);
        if (!parsed.success) {
          return reply.status(400).send({
            error: 'invalid_body',
            message: 'Body, when present, must be { reason?: string } with no extra keys',
            requestId: req.id,
          });
        }
        reason = parsed.data.reason;
      }

      const { activity_id, event_id } = req.params;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;

      // Activity existence + claim-stage gate + linked-event lookup in
      // one tx. Same pattern as POST.
      const guard = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const activityRows = await tx<
          {
            id: string;
            project_id: string;
            subject_tenant_id: string;
            claim_stage: string;
          }[]
        >`
          SELECT a.id, a.project_id,
                 c.stage AS claim_stage,
                 c.subject_tenant_id AS subject_tenant_id
            FROM activity a
            JOIN claim c ON c.id = a.claim_id
           WHERE a.id = ${activity_id}
             AND a.tenant_id = ${tenantId}
        `;
        const activity = activityRows[0];
        if (!activity) return { kind: 'activity_not_found' as const };
        if (activity.claim_stage === 'submitted' || activity.claim_stage === 'audit_defence') {
          return { kind: 'claim_locked' as const, stage: activity.claim_stage };
        }
        return {
          kind: 'ok' as const,
          project_id: activity.project_id,
          subject_tenant_id: activity.subject_tenant_id,
        };
      });

      if (guard.kind === 'activity_not_found') {
        return reply.status(404).send({
          error: 'activity_not_found',
          message: 'No activity with that id in this firm',
          requestId: req.id,
        });
      }
      if (guard.kind === 'claim_locked') {
        return reply.status(409).send({
          error: 'claim_locked',
          message: `Cannot unlink artefacts on a claim in stage "${guard.stage}"`,
          requestId: req.id,
        });
      }

      // Look up the original LINKED event (must be for this activity AND
      // not already unlinked). The helper folds LINKED/UNLINKED for the
      // activity and returns null if `event_id` isn't currently live.
      const linked = await findLinkedEventForActivity(event_id, activity_id, { tenantId });
      if (!linked) {
        // Disambiguate: not found vs. already unlinked. We do a second
        // existence check with kind='ARTEFACT_LINKED' but no liveness
        // requirement — distinguishing 404 from 409 in the error gives
        // the consultant portal a clearer signal (already-unlinked is a
        // recoverable race; truly-missing is a stale URL).
        const existsRows = await sql<{ id: string }[]>`
          SELECT id FROM event
           WHERE id = ${event_id}
             AND kind = 'ARTEFACT_LINKED'
             AND payload ->> 'activity_id' = ${activity_id}
             AND tenant_id = ${tenantId}
        `;
        if (existsRows.length === 0) {
          return reply.status(404).send({
            error: 'linked_event_not_found',
            message: 'No ARTEFACT_LINKED event with that id for this activity in this firm',
            requestId: req.id,
          });
        }
        return reply.status(409).send({
          error: 'already_unlinked',
          message: 'Artefact has already been unlinked from this activity',
          requestId: req.id,
        });
      }

      // Write ARTEFACT_UNLINKED carrying the same (activity, artefact)
      // tuple as the original LINKED event. Append-only — the LINKED
      // event itself is preserved.
      const unlinkedPayload = ArtefactUnlinkedPayload.parse({
        activity_id,
        artefact_kind: linked.artefact_kind,
        artefact_id: linked.artefact_id,
        ...(reason !== undefined ? { reason } : {}),
      });
      const inserted = await insertEventWithChain({
        tenant_id: tenantId,
        subject_tenant_id: guard.subject_tenant_id,
        project_id: guard.project_id,
        kind: 'ARTEFACT_UNLINKED',
        payload: unlinkedPayload,
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
      });

      return reply.status(200).send({
        unlinked_event_id: inserted.id,
        prior_event_id: linked.id,
        activity_id,
        artefact_kind: linked.artefact_kind,
        artefact_id: linked.artefact_id,
      });
    },
  );
}
