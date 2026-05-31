import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { insertEventWithChain } from '@cpa/db';
import { NarrativeDraftedPayload, Uuid } from '@cpa/schemas';
import { computeIdempotencyKey, isAgentEnabled, isTenantAllowed } from '@cpa/agents/runtime';
import {
  SECTION_KINDS,
  streamNarrativeDraft,
  type ActivityContext,
  type NarrativeSegment,
  type ProjectContext,
  type SectionKind,
} from '@cpa/agents/narrative-drafter';
import { startSSEStream } from '../lib/sse.js';
import {
  RegenerateRequestBody,
  deriveAuFiscalYear,
  hashSectionSegments,
  loadActivityForTenant,
  loadAllDraftSectionsForActivity,
  loadClusteredEventIds,
  loadCompressedEvents,
  loadExistingRegen,
} from './narrative-helpers.js';

/**
 * Single-section regenerate endpoint (Task 5.6).
 *
 *   POST /v1/activities/:id/narrative/sections/:section_kind/regenerate
 *
 * Streams a fresh model run for ONE section (the requested one),
 * UPDATEs the existing narrative_draft row in-place (bumping
 * current_version), APPENDs a new narrative_draft_version row with
 * generation_kind='section_regen' and parent_version pointing at the
 * version the regen replaced, then emits a single NARRATIVE_DRAFTED
 * chain event for the regenerated section. The other three sections
 * are NOT touched.
 *
 * Idempotency: a successful regen records `client_request_id` (when
 * provided) as the chain event's `idempotency_key`. A retry with the
 * same id short-circuits to a single `done` frame echoing the prior
 * version.
 */
export function registerNarrativeRegenerate(app: FastifyInstance): void {
  app.post<{
    Params: { id: string; section_kind: string };
  }>(
    '/v1/activities/:id/narrative/sections/:section_kind/regenerate',
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

      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;
      const activityId = req.params.id;
      const sectionKindParam = req.params.section_kind;

      if (!Uuid.safeParse(activityId).success) {
        return reply.status(400).send({
          error: 'invalid_activity_id',
          message: 'activity id must be a uuid',
          requestId: req.id,
        });
      }

      // Validate section_kind path param against the canonical enum.
      // Narrowing here unlocks `as SectionKind` further down without an
      // unsafe cast.
      const isValidSectionKind = (s: string): s is SectionKind =>
        (SECTION_KINDS as readonly string[]).includes(s);
      if (!isValidSectionKind(sectionKindParam)) {
        return reply.status(400).send({
          error: 'invalid_section_kind',
          message: `section_kind must be one of: ${SECTION_KINDS.join(', ')}`,
          requestId: req.id,
        });
      }
      const requestedSection: SectionKind = sectionKindParam;

      const bodyParse = RegenerateRequestBody.safeParse(req.body);
      if (!bodyParse.success) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: 'Body must be empty or { client_request_id?: string }',
          requestId: req.id,
        });
      }
      const clientRequestId = bodyParse.data?.client_request_id ?? null;

      // Feature gate.
      if (!isAgentEnabled('C') || !isTenantAllowed(tenantId)) {
        return reply.status(503).send({
          error: 'feature_disabled',
          message: 'Narrative drafter is currently disabled for this tenant',
          requestId: req.id,
        });
      }

      // Activity load.
      const activity = await loadActivityForTenant(activityId, tenantId);
      if (!activity) {
        return reply.status(404).send({
          error: 'activity_not_found',
          message: 'No activity with that id in this firm',
          requestId: req.id,
        });
      }

      // Load the current draft rows. Regen requires an existing draft —
      // we never create-on-regen.
      const draftRows = await loadAllDraftSectionsForActivity(activityId, tenantId);
      if (draftRows.length === 0) {
        return reply.status(404).send({
          error: 'no_draft_to_regenerate',
          message:
            'no draft to regenerate; use POST /v1/activities/:id/narrative for initial generation',
          requestId: req.id,
        });
      }

      // The requested section must exist in the loaded set. (In practice
      // initial-generation writes all four; this guard is defensive.)
      const requestedRow = draftRows.find((r) => r.section_kind === requestedSection);
      if (!requestedRow) {
        return reply.status(404).send({
          error: 'no_draft_to_regenerate',
          message: `no narrative_draft row for section_kind=${requestedSection}`,
          requestId: req.id,
        });
      }

      // Idempotency short-circuit. We probe by (activity, section,
      // client_request_id) and emit a single `done` frame on hit.
      if (clientRequestId !== null) {
        const existing = await loadExistingRegen(
          activityId,
          requestedSection,
          tenantId,
          clientRequestId,
        );
        if (existing) {
          const sse = startSSEStream(reply);
          sse.send('done', {
            idempotent: true,
            draft_id: existing.draft_id,
            version: existing.version,
            narrative_drafted_event_id: existing.event_id,
          });
          sse.close();
          return reply;
        }
      }

      // Derive clustered_events. Same constraints as initial gen — a
      // regen still needs the audit-anchor scope for the validator.
      const clusteredEventIds = await loadClusteredEventIds(
        activityId,
        activity.project_id,
        tenantId,
      );
      if (clusteredEventIds === null || clusteredEventIds.length === 0) {
        return reply.status(400).send({
          error: 'no_clustered_events',
          message:
            clusteredEventIds === null
              ? 'activity not associated with a register draft; cannot derive clustered_events'
              : 'activity has zero clustered_events; nothing for the model to narrate',
          requestId: req.id,
        });
      }

      const compressed = await loadCompressedEvents(clusteredEventIds, tenantId);

      // Build existing_sections from ALL four loaded rows so the
      // regenerate prompt has the full context (even the requested
      // section — the model can use the original wording as a stylistic
      // anchor for the rewrite). Missing sections (defensive) map to [].
      const existingSections: Record<SectionKind, NarrativeSegment[]> = {
        new_knowledge: [],
        hypothesis: [],
        uncertainty: [],
        experiments_and_results: [],
      };
      for (const row of draftRows) {
        existingSections[row.section_kind] = row.segments;
      }

      const statutoryAnchor: 's.355-25' | 's.355-30' =
        activity.kind === 'core' ? 's.355-25' : 's.355-30';
      const activityCtx: ActivityContext = {
        id: activity.id,
        name: activity.title,
        kind: activity.kind,
        statutory_anchor: statutoryAnchor,
        project_id: activity.project_id,
      };
      const projectCtx: ProjectContext = {
        id: activity.project_id,
        name: activity.project_name,
        industry_sector: activity.industry_sector,
        fiscal_year: activity.fiscal_year ?? deriveAuFiscalYear(activity.project_started_at),
      };

      // ─── Open SSE + abort wiring ────────────────────────────────
      const abortController = new AbortController();
      reply.raw.on('close', () => {
        abortController.abort();
      });
      const sse = startSSEStream(reply);

      const newSegments: NarrativeSegment[] = [];
      let model = '';
      let promptVersion = 'regenerate-section@1.0.0';
      let totalSegments = 0;
      let totalClaims = 0;
      let validationDowngradedCount = 0;
      let streamErrored = false;

      try {
        for await (const ev of streamNarrativeDraft({
          activity: activityCtx,
          project: projectCtx,
          clustered_events: compressed,
          prefill: null,
          existing_sections: existingSections,
          target_section_kinds: [requestedSection],
          abortSignal: abortController.signal,
        })) {
          if (abortController.signal.aborted) {
            streamErrored = true;
            break;
          }
          if (ev.type === 'segment') {
            // Only the requested section should appear in `segment`
            // events — but defensively filter anyway.
            if (ev.section_kind === requestedSection) {
              newSegments.push(ev.segment);
            }
            sse.send('segment', {
              section_kind: ev.section_kind,
              segment_index: ev.segment_index,
              segment: ev.segment,
            });
          } else if (ev.type === 'section_complete') {
            sse.send('section_complete', {
              section_kind: ev.section_kind,
              segment_count: ev.segment_count,
              claim_count: ev.claim_count,
            });
          } else if (ev.type === 'error') {
            streamErrored = true;
            sse.send('error', { reason: ev.reason, retryable: ev.retryable });
            break;
          } else if (ev.type === 'done') {
            model = ev.model;
            promptVersion = ev.prompt_version;
            totalSegments = ev.total_segments;
            totalClaims = ev.total_claims;
            validationDowngradedCount = ev.validation_downgraded_count;
          }
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        streamErrored = true;
        try {
          sse.send('error', { reason, retryable: false });
        } catch {
          // raw response gone.
        }
      }

      if (streamErrored || abortController.signal.aborted) {
        sse.close();
        return reply;
      }

      // ─── Persistence: UPDATE narrative_draft + INSERT version row ─
      const oldVersion = requestedRow.current_version;
      const newVersion = oldVersion + 1;
      const newContentHash = hashSectionSegments(newSegments);
      const claimCount = newSegments.filter((s) => s.type === 'claim').length;
      const newVersionId = crypto.randomUUID();
      // sha256-form key for the chain event (event.idempotency_key has a
      // 64-hex-char CHECK constraint per migration 0006) AND for the
      // payload's `idempotency_key` field (Zod schema requires non-empty
      // string and the consumer side keys off the event column anyway).
      const computedIdempotencyKey = computeIdempotencyKey(
        promptVersion,
        JSON.stringify({
          activity_id: activityId,
          section_kind: requestedSection,
          version: newVersion,
          content_hash: newContentHash,
        }),
      );
      // What we stamp onto narrative_draft.idempotency_key. That column
      // has no format constraint, so we store `client_request_id`
      // verbatim when provided — the regen idempotency probe keys off
      // this column. Falls back to the computed sha256 when no client
      // id was provided (matching the initial-gen behaviour for the
      // mirror sections).
      const draftIdempotencyKey = clientRequestId ?? computedIdempotencyKey;

      try {
        await sql.begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

          // UPDATE the live draft row in-place. We also bump
          // idempotency_key to the regen's anchor so subsequent
          // probes (if any) can match this regen too — the column is
          // a single-slot tracker and the most-recent run wins.
          await tx`
              UPDATE narrative_draft
                 SET segments = ${JSON.stringify(newSegments)}::text::jsonb,
                     content_hash = ${newContentHash},
                     current_version = ${newVersion},
                     model = ${model},
                     prompt_version = ${promptVersion},
                     status = 'complete',
                     idempotency_key = ${draftIdempotencyKey},
                     updated_at = now()
               WHERE tenant_id = ${tenantId}
                 AND id = ${requestedRow.id}
            `;

          // INSERT the new version row. parent_version = the version
          // we just replaced; generation_kind = 'section_regen'.
          await tx`
              INSERT INTO narrative_draft_version (
                tenant_id, id, draft_id, version, segments, content_hash,
                model, prompt_version, parent_version, generation_kind,
                created_by_user_id
              )
              VALUES (
                ${tenantId}, ${newVersionId}, ${requestedRow.id}, ${newVersion},
                ${JSON.stringify(newSegments)}::text::jsonb,
                ${newContentHash}, ${model}, ${promptVersion},
                ${oldVersion}, 'section_regen',
                ${userId}
              )
            `;
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        req.log.error(
          { err, activityId, tenantId, sectionKind: requestedSection },
          'narrative regen persistence failed',
        );
        try {
          sse.send('error', { reason: `persistence_failed: ${reason}`, retryable: false });
        } catch {
          // raw response gone.
        }
        sse.close();
        return reply;
      }

      // Emit a single NARRATIVE_DRAFTED chain event for the regenerated
      // section.
      let chainEventId = '';
      try {
        const payload = NarrativeDraftedPayload.parse({
          _v: 1,
          narrative_draft_id: requestedRow.id,
          activity_id: activityId,
          section_kind: requestedSection,
          version: newVersion,
          content_hash: newContentHash,
          model,
          prompt_version: promptVersion,
          segment_count: newSegments.length,
          claim_segment_count: claimCount,
          idempotency_key: computedIdempotencyKey,
        });
        const inserted = await insertEventWithChain({
          tenant_id: tenantId,
          subject_tenant_id: activity.project_subject_tenant_id,
          project_id: activity.project_id,
          kind: 'NARRATIVE_DRAFTED',
          payload,
          classification: null,
          captured_at: new Date(),
          captured_by_user_id: userId,
          override_of_event_id: null,
          override_new_kind: null,
          override_reason: null,
          idempotency_key: computedIdempotencyKey,
        });
        chainEventId = inserted.id;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        req.log.error(
          { err, activityId, tenantId, sectionKind: requestedSection },
          'NARRATIVE_DRAFTED chain emit failed (regen)',
        );
        try {
          sse.send('error', { reason: `chain_emit_failed: ${reason}`, retryable: true });
        } catch {
          // raw response gone.
        }
        sse.close();
        return reply;
      }

      sse.send('done', {
        idempotent: false,
        draft_id: requestedRow.id,
        version: newVersion,
        narrative_drafted_event_id: chainEventId,
        section_kind: requestedSection,
        total_segments: totalSegments,
        total_claims: totalClaims,
        validation_downgraded_count: validationDowngradedCount,
        model,
        prompt_version: promptVersion,
      });
      sse.close();
      return reply;
    },
  );
}
