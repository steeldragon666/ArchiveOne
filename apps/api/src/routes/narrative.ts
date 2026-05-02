import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { canonicalJsonStringify, insertEventWithChain } from '@cpa/db';
import { NarrativeDraftedPayload, Uuid } from '@cpa/schemas';
import { computeIdempotencyKey, isAgentEnabled, isTenantAllowed } from '@cpa/agents/runtime';
import {
  SECTION_KINDS,
  streamNarrativeDraft,
  type ActivityContext,
  type CompressedEvent,
  type NarrativeSegment,
  type ProjectContext,
  type SectionKind,
} from '@cpa/agents/narrative-drafter';
import { startSSEStream } from '../lib/sse.js';

/**
 * Agent C narrative endpoints (Task 5.5).
 *
 * Surface area on this branch:
 *
 *   POST /v1/activities/:id/narrative
 *     Admin/consultant only. Streams Agent C narrative segments via
 *     Server-Sent Events, then persists the four section drafts +
 *     emits four `NARRATIVE_DRAFTED` chain events on `done`.
 *
 * Wire format follows Task 2.1's {@link startSSEStream} convention:
 *
 *   event: segment            data: { section_kind, segment_index, segment }
 *   event: section_complete   data: { section_kind, segment_count, claim_count }
 *   event: error              data: { reason, retryable }   ← terminal, no done
 *   event: done               data: { draft_id, narrative_drafted_event_id, ...totals }
 *
 * Idempotency: a `client_request_id` echoes through to a deterministic
 * skip path. If a previous successful run already persisted a `version=1`
 * narrative_draft for this activity, the route emits a single `done`
 * event with `idempotent: true` (NO replay of segments) and exits — see
 * the `loadExistingInitialDraft` lookup below. Rationale: re-streaming
 * dozens of cached segments adds no semantic value (the consumer already
 * has them on the `narrative_draft` row); a one-event done is the
 * minimum signal the caller needs to know "no work was done".
 *
 * Auth + feature gates layer in this order (cheapest first):
 *   1. requireSession  → 401 / 403-no-tenant
 *   2. role check      → 403 (admin/consultant only)
 *   3. isAgentEnabled('C') + isTenantAllowed(tenantId) → 503
 *   4. activity load   → 404 if missing or cross-firm
 *   5. clustered_events derivation → 400 if empty / not derivable
 *
 * The route uses `req.user!.id` for both `narrative_draft.created_by_user_id`
 * and the chain event's `captured_by_user_id`. There is no Agent C
 * system user (the request is consultant-driven, unlike Agent B's
 * background synthesizer); the consultant's own id is the right
 * attribution. A future "background regen" job (Task 5.6+) may switch
 * to a system user, but this route is request-scoped.
 */

// ---------------------------------------------------------------------------
// Body schema
// ---------------------------------------------------------------------------

const NarrativeRequestBody = z
  .object({
    /** Optional client-side dedup token. Stored on `narrative_draft.idempotency_key`
     *  for the section_kind=new_knowledge row only (the rest mirror it).
     */
    client_request_id: z.string().min(1).max(200).optional(),
  })
  .strict()
  .or(z.undefined()); // empty body is fine

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROMPT_VERSION = 'draft-narrative@1.0.0';

/**
 * Activity row shape after the project join. RLS-scoped via the
 * tenant GUC — cross-firm rows are invisible.
 */
type ActivityRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  claim_id: string;
  code: string;
  title: string;
  kind: 'core' | 'supporting';
  project_name: string;
  industry_sector: string | null;
  project_started_at: Date | string;
  project_subject_tenant_id: string;
  fiscal_year: number | null;
};

async function loadActivityForTenant(
  activityId: string,
  tenantId: string,
): Promise<ActivityRow | null> {
  const rows = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return await tx<ActivityRow[]>`
      SELECT a.id,
             a.tenant_id,
             a.project_id,
             a.claim_id,
             a.code,
             a.title,
             a.kind,
             p.name             AS project_name,
             NULL::text         AS industry_sector,
             p.started_at       AS project_started_at,
             p.subject_tenant_id AS project_subject_tenant_id,
             c.fiscal_year      AS fiscal_year
        FROM activity a
        JOIN project  p ON p.id = a.project_id
   LEFT JOIN claim    c ON c.id = a.claim_id
       WHERE a.id = ${activityId}
         AND a.tenant_id = ${tenantId}
       LIMIT 1
    `;
  });
  return rows[0] ?? null;
}

/** July (UTC month 6) onward rolls into the NEXT calendar year's FY. */
function deriveAuFiscalYear(startedAt: Date | string): number {
  const date = typeof startedAt === 'string' ? new Date(startedAt) : startedAt;
  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();
  return month >= 6 ? year + 1 : year;
}

/**
 * Resolve the `clustered_event_ids` for an activity by walking back
 * through the Agent B chain:
 *
 *   1. Find the most-recent `ACTIVITY_CREATED` event whose payload
 *      mentions this activity_id; pull its `proposed_id` (set by the
 *      activity-register accept flow when the activity was promoted
 *      from a draft proposal).
 *   2. Find the matching `ACTIVITY_REGISTER_DRAFTED` event for the
 *      project; locate the proposed activity with that `proposed_id`
 *      in its `proposed_activities[]`; return its `clustered_event_ids`.
 *
 * Returns `null` for activities that were created OUTSIDE the Agent B
 * flow (e.g. manually via POST /v1/activities); those have no
 * `proposed_id` correlation and Agent C can't derive the audit-anchor
 * scope. The route surfaces that as a 400 (the activity needs to be
 * promoted via the register accept flow first).
 *
 * Returns `[]` when the proposed activity exists but its
 * `clustered_event_ids` array is empty — that's structurally
 * impossible per Zod's `.min(1)` on the schema, but we return the
 * empty array defensively so the empty-events 400 fires consistently.
 */
async function loadClusteredEventIds(
  activityId: string,
  projectId: string,
  tenantId: string,
): Promise<string[] | null> {
  return await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

    // Step 1: find the activity's proposed_id (most-recent ACTIVITY_CREATED).
    const createdRows = await tx<{ proposed_id: string | null }[]>`
      SELECT (payload ->> 'proposed_id') AS proposed_id
        FROM event
       WHERE tenant_id = ${tenantId}
         AND project_id = ${projectId}
         AND kind = 'ACTIVITY_CREATED'
         AND (payload ->> 'activity_id') = ${activityId}
       ORDER BY captured_at DESC, received_at DESC, id DESC
       LIMIT 1
    `;
    const proposedId = createdRows[0]?.proposed_id ?? null;
    if (proposedId === null) return null;

    // Step 2: find the most-recent ACTIVITY_REGISTER_DRAFTED for the
    // project that includes this proposed_id. We pull all of them and
    // walk newest-first to find the match (a project may have multiple
    // synth runs; we want the latest one that still mentions this
    // proposal — that's the run from which the activity was accepted).
    type DraftRow = {
      payload: {
        proposed_activities: Array<{ proposed_id: string; clustered_event_ids: string[] }>;
      };
    };
    const draftRows = await tx<DraftRow[]>`
      SELECT payload
        FROM event
       WHERE tenant_id = ${tenantId}
         AND project_id = ${projectId}
         AND kind = 'ACTIVITY_REGISTER_DRAFTED'
       ORDER BY captured_at DESC, received_at DESC, id DESC
    `;
    for (const row of draftRows) {
      const proposed = row.payload.proposed_activities.find((p) => p.proposed_id === proposedId);
      if (proposed) return proposed.clustered_event_ids;
    }
    return null;
  });
}

/**
 * Take the first 50 whitespace-separated words. Mirrors Agent B's
 * `truncateToFiftyWords` so the compressed-event shape is identical
 * across the two agents.
 */
function truncateToFiftyWords(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.split(/\s+/).slice(0, 50).join(' ');
}

/**
 * Hydrate compressed events for the model. Per spec: summary = first
 * 50 words of `payload.text` or `payload.raw_text`. Returns rows in the
 * order of `eventIds` (preserves the cluster's intended ordering even
 * though postgres doesn't guarantee it).
 */
async function loadCompressedEvents(
  eventIds: string[],
  tenantId: string,
): Promise<CompressedEvent[]> {
  if (eventIds.length === 0) return [];
  type Row = {
    id: string;
    kind: string;
    captured_at: Date | string;
    payload: unknown;
  };
  const rows = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return await tx<Row[]>`
      SELECT id, kind, captured_at, payload
        FROM event
       WHERE tenant_id = ${tenantId}
         AND id = ANY(${eventIds}::uuid[])
    `;
  });
  // Index by id so we can return in caller order.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: CompressedEvent[] = [];
  for (const id of eventIds) {
    const row = byId.get(id);
    if (!row) continue; // event was deleted/cross-firm; skip silently
    let text: unknown;
    if (row.payload !== null && typeof row.payload === 'object') {
      const p = row.payload as Record<string, unknown>;
      text = p.text ?? p.raw_text ?? null;
    }
    // postgres-js can return timestamptz as either Date or ISO string
    // depending on which client opened the tx; coerce both shapes here.
    const capturedAtIso =
      typeof row.captured_at === 'string'
        ? new Date(row.captured_at).toISOString()
        : row.captured_at.toISOString();
    out.push({
      id: row.id,
      kind: row.kind,
      captured_at: capturedAtIso,
      summary: truncateToFiftyWords(text),
    });
  }
  return out;
}

/**
 * Lookup whether a `version=1` initial draft already exists for this
 * activity. Used for the idempotency short-circuit. Returns the
 * matching draft row's `id` and the chain-event id of its
 * `NARRATIVE_DRAFTED` emission (looked up by `narrative_draft_id`)
 * so the response can echo both back to the caller.
 */
async function loadExistingInitialDraft(
  activityId: string,
  tenantId: string,
  clientRequestId: string | null,
): Promise<{ draft_id: string; event_id: string | null } | null> {
  return await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    // Match on activity + section=new_knowledge + version=1 +
    // (idempotency_key OR null). We use new_knowledge as the canonical
    // probe row since all four section rows are written in the same
    // transaction.
    const rows = await tx<{ id: string; idempotency_key: string | null }[]>`
      SELECT id, idempotency_key
        FROM narrative_draft
       WHERE tenant_id = ${tenantId}
         AND activity_id = ${activityId}
         AND section_kind = 'new_knowledge'
         AND current_version = 1
       LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    // If the caller passed a client_request_id, only treat this as
    // idempotent when it matches the stored key. A draft created by a
    // DIFFERENT request is not the same idempotent unit of work.
    if (clientRequestId !== null && row.idempotency_key !== clientRequestId) {
      return null;
    }
    // Find the NARRATIVE_DRAFTED chain event for this draft (best-effort).
    const evtRows = await tx<{ id: string }[]>`
      SELECT id
        FROM event
       WHERE tenant_id = ${tenantId}
         AND kind = 'NARRATIVE_DRAFTED'
         AND (payload ->> 'narrative_draft_id') = ${row.id}
       ORDER BY captured_at DESC, received_at DESC, id DESC
       LIMIT 1
    `;
    return { draft_id: row.id, event_id: evtRows[0]?.id ?? null };
  });
}

/**
 * Per-section content hash. The `narrative_draft.content_hash` column
 * stores the hash of THAT section's segments only (not the four-section
 * record): we hash `canonicalJsonStringify(<sorted-claim-citations
 * segments>)` so consumers can recompute from the persisted row alone.
 *
 * Distinct from `hashSections` (`@cpa/db/narrative-canonical`), which
 * canonicalises ALL FOUR sections and returns one aggregate hash —
 * that's the right helper for an aggregate-level audit anchor on a
 * narrative-as-a-whole event, not for the per-row column we're
 * persisting here. The two would only coincide if all four sections
 * were folded into one row, which the schema explicitly does not.
 */
function hashSectionSegments(segments: readonly NarrativeSegment[]): string {
  // Mirror the canonicaliseSections claim-citation sort: a re-emit
  // that reorders citing_events shouldn't read as a different hash.
  const canonical = segments.map((s) =>
    s.type === 'claim'
      ? { type: 'claim' as const, text: s.text, citing_events: [...s.citing_events].sort() }
      : { type: 'prose' as const, text: s.text },
  );
  return crypto
    .createHash('sha256')
    .update(canonicalJsonStringify(canonical), 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerNarrative(app: FastifyInstance): void {
  app.post<{
    Params: { id: string };
  }>('/v1/activities/:id/narrative', { preHandler: requireSession }, async (req, reply) => {
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

    // Validate activityId shape so a path-traversal-style /narrative
    // call doesn't reach SQL with garbage.
    if (!Uuid.safeParse(activityId).success) {
      return reply.status(400).send({
        error: 'invalid_activity_id',
        message: 'activity id must be a uuid',
        requestId: req.id,
      });
    }

    const bodyParse = NarrativeRequestBody.safeParse(req.body);
    if (!bodyParse.success) {
      return reply.status(400).send({
        error: 'invalid_body',
        message: 'Body must be empty or { client_request_id?: string }',
        requestId: req.id,
      });
    }
    const clientRequestId = bodyParse.data?.client_request_id ?? null;

    // Feature gate. 503 surface lets clients distinguish "agent
    // disabled" from genuine 5xx.
    if (!isAgentEnabled('C') || !isTenantAllowed(tenantId)) {
      return reply.status(503).send({
        error: 'feature_disabled',
        message: 'Narrative drafter is currently disabled for this tenant',
        requestId: req.id,
      });
    }

    // Activity load + RLS check.
    const activity = await loadActivityForTenant(activityId, tenantId);
    if (!activity) {
      return reply.status(404).send({
        error: 'activity_not_found',
        message: 'No activity with that id in this firm',
        requestId: req.id,
      });
    }

    // Derive clustered_events. 400 if the activity has no proposed_id
    // correlation (manually-created activity → no Agent B history).
    const clusteredEventIds = await loadClusteredEventIds(
      activityId,
      activity.project_id,
      tenantId,
    );
    if (clusteredEventIds === null) {
      return reply.status(400).send({
        error: 'no_clustered_events',
        message: 'activity not associated with a register draft; cannot derive clustered_events',
        requestId: req.id,
      });
    }
    if (clusteredEventIds.length === 0) {
      return reply.status(400).send({
        error: 'no_clustered_events',
        message: 'activity has zero clustered_events; nothing for the model to narrate',
        requestId: req.id,
      });
    }

    // Idempotency check. A version=1 draft already existing for this
    // (activity, client_request_id) is a successful no-op: emit one
    // `done` event with `idempotent: true` and exit. We DO NOT replay
    // segments — the consumer already has them on narrative_draft.
    const existing = await loadExistingInitialDraft(activityId, tenantId, clientRequestId);
    if (existing) {
      const sse = startSSEStream(reply);
      sse.send('done', {
        idempotent: true,
        draft_id: existing.draft_id,
        narrative_drafted_event_id: existing.event_id,
      });
      sse.close();
      return reply;
    }

    // Hydrate the model's input bundle.
    const compressed = await loadCompressedEvents(clusteredEventIds, tenantId);

    // Tighter activity context for Agent C.
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

    // ─── Open SSE + abort wiring ───────────────────────────────────
    const abortController = new AbortController();
    reply.raw.on('close', () => {
      // Client disconnected. Aborting cancels the upstream Anthropic
      // stream; the orchestrator yields an error event we do NOT
      // forward (the client is gone), and persistence is skipped.
      abortController.abort();
    });
    const sse = startSSEStream(reply);

    // Drain the orchestrator. We collect segments by section so the
    // final persistence step has the canonical-ordered list.
    const segmentsBySection = new Map<SectionKind, NarrativeSegment[]>();
    for (const k of SECTION_KINDS) segmentsBySection.set(k, []);

    let model = '';
    let promptVersion = PROMPT_VERSION;
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
        existing_sections: null,
        target_section_kinds: [...SECTION_KINDS],
        abortSignal: abortController.signal,
      })) {
        if (abortController.signal.aborted) {
          streamErrored = true;
          break;
        }
        if (ev.type === 'segment') {
          const buf = segmentsBySection.get(ev.section_kind) ?? [];
          buf.push(ev.segment);
          segmentsBySection.set(ev.section_kind, buf);
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
          break; // do NOT persist on an error path
        } else if (ev.type === 'done') {
          // Capture metadata; persistence + final `done` happen below.
          model = ev.model;
          promptVersion = ev.prompt_version;
          totalSegments = ev.total_segments;
          totalClaims = ev.total_claims;
          validationDowngradedCount = ev.validation_downgraded_count;
        }
      }
    } catch (err) {
      // Unexpected — orchestrator's contract is to emit `error` and
      // return cleanly. Surface as an SSE error frame.
      const reason = err instanceof Error ? err.message : String(err);
      streamErrored = true;
      try {
        sse.send('error', { reason, retryable: false });
      } catch {
        // raw response already torn down — nothing to do.
      }
    }

    if (streamErrored || abortController.signal.aborted) {
      sse.close();
      return reply;
    }

    // ─── Persistence + chain emission ─────────────────────────────
    // All four sections + their version rows + (best-effort) chain
    // events go in one transaction so a failure rolls back.
    // captured_by_user_id = the requesting consultant; there is no
    // Agent C system user (the request is consultant-driven).
    type PersistedRow = {
      section_kind: SectionKind;
      draft_id: string;
      content_hash: string;
      segment_count: number;
      claim_segment_count: number;
      idempotency_key: string;
    };
    let persisted: PersistedRow[];
    try {
      persisted = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        const out: PersistedRow[] = [];
        for (const sectionKind of SECTION_KINDS) {
          const segs = segmentsBySection.get(sectionKind) ?? [];
          const contentHash = hashSectionSegments(segs);
          const claimCount = segs.filter((s) => s.type === 'claim').length;
          const draftId = crypto.randomUUID();
          // Idempotency key per-section. The new_knowledge row also
          // stores `client_request_id` (verbatim) so the
          // loadExistingInitialDraft probe can find it.
          const idempotencyKey = computeIdempotencyKey(
            promptVersion,
            JSON.stringify({
              activity_id: activityId,
              section_kind: sectionKind,
              content_hash: contentHash,
            }),
          );
          const storedIdempotencyKey =
            sectionKind === 'new_knowledge' && clientRequestId !== null
              ? clientRequestId
              : idempotencyKey;

          await tx`
              INSERT INTO narrative_draft (
                tenant_id, id, activity_id, section_kind, current_version, status,
                segments, content_hash, model, prompt_version, idempotency_key,
                created_by_user_id
              )
              VALUES (
                ${tenantId}, ${draftId}, ${activityId}, ${sectionKind}, 1, 'complete',
                ${JSON.stringify(segs)}::text::jsonb,
                ${contentHash}, ${model}, ${promptVersion}, ${storedIdempotencyKey},
                ${userId}
              )
            `;
          await tx`
              INSERT INTO narrative_draft_version (
                tenant_id, id, draft_id, version, segments, content_hash,
                model, prompt_version, parent_version, generation_kind,
                created_by_user_id
              )
              VALUES (
                ${tenantId}, ${crypto.randomUUID()}, ${draftId}, 1,
                ${JSON.stringify(segs)}::text::jsonb,
                ${contentHash}, ${model}, ${promptVersion}, NULL, 'initial',
                ${userId}
              )
            `;
          out.push({
            section_kind: sectionKind,
            draft_id: draftId,
            content_hash: contentHash,
            segment_count: segs.length,
            claim_segment_count: claimCount,
            idempotency_key: idempotencyKey,
          });
        }
        return out;
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      req.log.error({ err, activityId, tenantId }, 'narrative persistence failed');
      try {
        sse.send('error', { reason: `persistence_failed: ${reason}`, retryable: false });
      } catch {
        // raw response gone — nothing to do.
      }
      sse.close();
      return reply;
    }

    // Emit chain events. We do this AFTER the transaction so that
    // `insertEventWithChain`'s per-subject_tenant advisory lock
    // doesn't widen our hot transaction window. Each event is
    // independently chained — a partial failure is recoverable
    // (the draft rows are persisted; a re-emit job can backfill
    // the missing chain entries).
    const eventIds: Record<SectionKind, string> = {
      new_knowledge: '',
      hypothesis: '',
      uncertainty: '',
      experiments_and_results: '',
    };
    try {
      for (const row of persisted) {
        const payload = NarrativeDraftedPayload.parse({
          _v: 1,
          narrative_draft_id: row.draft_id,
          activity_id: activityId,
          section_kind: row.section_kind,
          version: 1,
          content_hash: row.content_hash,
          model,
          prompt_version: promptVersion,
          segment_count: row.segment_count,
          claim_segment_count: row.claim_segment_count,
          idempotency_key: row.idempotency_key,
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
          idempotency_key: row.idempotency_key,
        });
        eventIds[row.section_kind] = inserted.id;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      req.log.error({ err, activityId, tenantId }, 'NARRATIVE_DRAFTED chain emit failed');
      try {
        sse.send('error', { reason: `chain_emit_failed: ${reason}`, retryable: true });
      } catch {
        // raw response gone — nothing to do.
      }
      sse.close();
      return reply;
    }

    const firstSection: SectionKind = 'new_knowledge';
    const firstRow = persisted.find((r) => r.section_kind === firstSection)!;
    sse.send('done', {
      idempotent: false,
      draft_id: firstRow.draft_id,
      narrative_drafted_event_id: eventIds[firstSection],
      total_segments: totalSegments,
      total_claims: totalClaims,
      validation_downgraded_count: validationDowngradedCount,
      model,
      prompt_version: promptVersion,
    });
    sse.close();
    return reply;
  });
}

// ─── Internal exports for testing ─────────────────────────────────────
// (none today — the test file mocks at the streamNarrativeDraft layer
// via `_setStreamingClientForTests` and exercises this module via
// app.inject).
