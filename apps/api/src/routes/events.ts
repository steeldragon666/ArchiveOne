import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import {
  computeIdempotencyKey,
  lookupCache,
  makeClassifier,
  makeAutoAllocator,
  withAgentSpan,
  writeCache,
  type Classifier,
  type ClassifierOutput,
  type AutoAllocator,
} from '@cpa/agents';
import { insertEventWithChain, nextActivityCode } from '@cpa/db';
import { sql } from '@cpa/db/client';
import {
  createEventBody,
  listEventsQuery,
  overrideEventBody,
  type Classification,
  type Event as ApiEvent,
} from '@cpa/schemas';
import { getBoss } from '../lib/pg-boss-client.js';
import { DOCUMENT_EXTRACT_QUEUE } from '../jobs/document-extract.js';

// Lazy classifier singleton — first request constructs it, subsequent
// requests reuse. Lazy (not module-init) so the test runner can set
// CLASSIFIER_IMPL=stub between import time and first injected request, and
// so a misconfigured ANTHROPIC_API_KEY surfaces as a per-request 503 rather
// than a process-wide boot failure.
let classifierInstance: Classifier | null = null;
const getClassifier = (): Classifier => {
  if (!classifierInstance) classifierInstance = makeClassifier();
  return classifierInstance;
};

// Lazy auto-allocator singleton — same rationale as classifier.
let allocatorInstance: AutoAllocator | null = null;
const getAllocator = (): AutoAllocator => {
  if (!allocatorInstance) allocatorInstance = makeAutoAllocator();
  return allocatorInstance;
};

interface RawEventViewRow {
  id: string;
  tenant_id: string;
  subject_tenant_id: string;
  project_id: string | null;
  milestone_id: string | null;
  kind: string;
  effective_kind: string;
  is_overridden: boolean;
  payload: unknown;
  classification: unknown;
  override_of_event_id: string | null;
  override_new_kind: string | null;
  override_reason: string | null;
  prev_hash: string | null;
  hash: string;
  idempotency_key: string | null;
  captured_at: Date | string;
  captured_by_user_id: string;
  received_at: Date | string;
}

const isoOf = (v: Date | string): string => (typeof v === 'string' ? v : v.toISOString());

const rowToEvent = (r: RawEventViewRow): ApiEvent => ({
  id: r.id,
  tenant_id: r.tenant_id,
  subject_tenant_id: r.subject_tenant_id,
  project_id: r.project_id,
  milestone_id: r.milestone_id,
  // The DB CHECK constraints already restrict kind/effective_kind to the
  // EVIDENCE_KINDS set (migration 0006 + 0007 view). Coerce for the type
  // contract; runtime validation isn't useful since we're reading back rows
  // we just wrote.
  kind: r.kind as ApiEvent['kind'],
  effective_kind: r.effective_kind as ApiEvent['effective_kind'],
  is_overridden: r.is_overridden,
  payload: r.payload,
  classification: r.classification as Classification | null,
  override_of_event_id: r.override_of_event_id,
  override_new_kind: r.override_new_kind as ApiEvent['override_new_kind'],
  override_reason: r.override_reason,
  prev_hash: r.prev_hash,
  hash: r.hash,
  idempotency_key: r.idempotency_key,
  captured_at: isoOf(r.captured_at),
  captured_by_user_id: r.captured_by_user_id,
  received_at: isoOf(r.received_at),
});

const isAnthropicExhausted = (e: unknown): boolean => {
  // Anthropic SDK errors carry a .status (HTTP code). 529 = Overloaded;
  // anything 5xx from the upstream model is "exhausted" from our POV.
  const status = (e as { status?: number }).status;
  return typeof status === 'number' && status >= 500;
};

/**
 * Register the event-capture routes (POST/GET/override).
 *
 * Auth: every route requires a session (requireSession). Per-claimant ACL
 * checks are deferred to RLS — the subject_tenant table's policy filters
 * cross-firm rows automatically.
 */
export function registerEvents(app: FastifyInstance): void {
  app.post('/v1/events', { preHandler: requireSession }, async (req, reply) => {
    const parsed = createEventBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_body',
        message: 'Body must be { subject_tenant_id, raw_text, captured_at? }',
        requestId: req.id,
      });
    }
    const { subject_tenant_id, raw_text, captured_at } = parsed.data;
    const tenantId = req.user!.tenantId!;
    const userId = req.user!.id;
    const capturedAt = captured_at ? new Date(captured_at) : new Date();

    // Step 1: confirm the subject_tenant is visible (and live) under RLS.
    // 404 covers both "doesn't exist" and "exists in another firm".
    const subjectVisible = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const rows = await tx<{ id: string }[]>`
        SELECT id FROM subject_tenant
         WHERE id = ${subject_tenant_id} AND deleted_at IS NULL
      `;
      return rows[0] != null;
    });
    if (!subjectVisible) {
      return reply.status(404).send({
        error: 'subject_tenant_not_found',
        message: 'No subject_tenant with that id in this firm',
        requestId: req.id,
      });
    }

    // Step 2: classify with idempotency cache. Key = SHA256(prompt_version
    // || NUL || raw_text). The cache is content-addressed across tenants
    // (same paste in two firms legitimately gets the same answer).
    //
    // We bind the prompt version statically here so a deploy that bumps
    // the prompt invalidates older cache entries — the wire format
    // (computeIdempotencyKey input) folds prompt_version into the key, so
    // this is automatic.
    const PROMPT_KEY = 'classify@1.0.0';
    const idempotencyKey = computeIdempotencyKey(PROMPT_KEY, raw_text);

    let classification: ClassifierOutput;
    try {
      classification = await withAgentSpan(
        'classify',
        {
          agent_name: 'classifier',
          prompt_version: PROMPT_KEY,
          model: process.env['CLASSIFIER_MODEL'] ?? 'haiku',
          tenant_id: tenantId,
          subject_tenant_id,
        },
        async (setAttr) => {
          const cached = await lookupCache(idempotencyKey);
          if (cached) {
            setAttr({ cache_hit: true });
            // Cached output shape matches ClassifierOutput by construction
            // (writeCache below stores the same object).
            return cached.output as ClassifierOutput;
          }
          setAttr({ cache_hit: false });
          const out = await getClassifier().classify({ raw_text });
          setAttr({
            tokens_in: out.tokens_in,
            tokens_out: out.tokens_out,
            classification_kind: out.kind,
            classification_confidence: out.confidence,
          });
          // ON CONFLICT DO NOTHING — first write wins; concurrent identical
          // requests don't clobber each other (idempotency contract).
          await writeCache({
            idempotency_key: idempotencyKey,
            agent_name: 'classifier',
            prompt_version: out.prompt_version,
            output: out,
            tokens_in: out.tokens_in,
            tokens_out: out.tokens_out,
            model: out.model,
          });
          return out;
        },
      );
    } catch (e) {
      if (isAnthropicExhausted(e)) {
        req.log.warn({ err: e }, 'classifier upstream exhausted');
        return reply.status(503).send({
          error: 'classifier_unavailable',
          message: 'Classifier upstream is unavailable; retry shortly',
          requestId: req.id,
        });
      }
      throw e;
    }

    // Step 3: extend the chain. The chain helper holds a per-subject
    // advisory lock so concurrent inserts on the same chain serialise.
    const inserted = await insertEventWithChain({
      tenant_id: tenantId,
      subject_tenant_id,
      // Chain canonicalisation includes `kind` — set to the classifier's
      // kind so the hash captures the classification at insert time.
      kind: classification.kind,
      payload: { _v: 1, source: 'paste', raw_text },
      classification,
      captured_at: capturedAt,
      captured_by_user_id: userId,
      override_of_event_id: null,
      override_new_kind: null,
      override_reason: null,
      idempotency_key: idempotencyKey,
    });

    // Step 4: read back via the view so effective_kind / is_overridden are
    // populated. RLS-scoped — same tenantId GUC.
    const fresh = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const rows = await tx<RawEventViewRow[]>`
        SELECT * FROM event_with_effective_kind WHERE id = ${inserted.id}
      `;
      return rows[0];
    });
    if (!fresh) {
      // Should be unreachable — we just inserted under the same tenant.
      throw new Error('POST /v1/events: inserted row not visible via view');
    }

    // Step 5: if this is a file-upload event with extracted text, enqueue
    // the document-analyzer job so the AI can propose activities + invoices.
    // Non-fatal — if pg-boss is unavailable (e.g. tests) we just skip.
    if (raw_text.includes('[FILE UPLOAD] ') && raw_text.includes('Extracted-Text:')) {
      try {
        if (process.env['NODE_ENV'] !== 'test') {
          const boss = await getBoss();
          await boss.send(DOCUMENT_EXTRACT_QUEUE, {
            event_id: inserted.id,
            tenant_id: tenantId,
            subject_tenant_id,
          });
          // Mark as pending so the UI shows a "extracting…" state immediately.
          await sql.begin(async (tx) => {
            await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
            await tx`
              UPDATE event
                 SET extraction_status = 'pending'
               WHERE id        = ${inserted.id}
                 AND tenant_id = ${tenantId}
            `;
          });
        }
      } catch {
        // pg-boss enqueue failure is non-fatal; the event is already persisted.
        req.log.warn({ event_id: inserted.id }, 'document-extract enqueue failed');
      }
    }

    return reply.status(201).send({ event: rowToEvent(fresh) });
  });

  app.get('/v1/events', { preHandler: requireSession }, async (req, reply) => {
    const parsed = listEventsQuery.safeParse(req.query);
    if (!parsed.success) {
      // Surface Zod's per-issue messages so the caller learns WHICH constraint
      // failed — the refine ('Either subject_tenant_id or activity_id is
      // required') and the kind validator's per-token 'Unknown event kind: X'
      // are the diagnostics consultants actually need. Joining with '; '
      // keeps this single-line for log/UI consumption.
      const message = parsed.error.issues.map((i) => i.message).join('; ') || 'Invalid query';
      return reply.status(400).send({
        error: 'invalid_query',
        message,
        requestId: req.id,
      });
    }
    const { subject_tenant_id, activity_id, project_id, filter, limit, cursor, kind } = parsed.data;
    const tenantId = req.user!.tenantId!;

    // Decode the opaque cursor. Forward-pagination only (older first → next).
    // The cursor encodes the tuple (captured_at, received_at, id) of the
    // last row on the previous page; the next page is "rows strictly less
    // than this tuple" since we sort DESC.
    const decoded = cursor ? decodeCursor(cursor) : null;
    if (cursor && !decoded) {
      return reply.status(400).send({
        error: 'invalid_cursor',
        message: 'cursor is malformed',
        requestId: req.id,
      });
    }

    // When the caller supplies activity_id without subject_tenant_id we
    // resolve the activity → subject_tenant_id under RLS so the
    // visibility predicate still scopes by claimant. Cross-firm activity
    // returns 404 (matches A3/A4 conventions). When BOTH are supplied we
    // trust the caller's subject_tenant_id and use activity_id as an
    // additional payload filter — the A6 register page passes both for
    // belt-and-braces narrowing.
    let scopedSubjectTenantId = subject_tenant_id;
    if (activity_id !== undefined && scopedSubjectTenantId === undefined) {
      const resolved = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ subject_tenant_id: string }[]>`
          SELECT c.subject_tenant_id
            FROM activity a
            JOIN claim c ON c.id = a.claim_id
           WHERE a.id = ${activity_id}
             AND a.tenant_id = ${tenantId}
        `;
        return rows[0] ?? null;
      });
      if (!resolved) {
        return reply.status(404).send({
          error: 'activity_not_found',
          message: 'No activity with that id in this firm',
          requestId: req.id,
        });
      }
      scopedSubjectTenantId = resolved.subject_tenant_id;
    }

    return await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

      // Use the view so effective_kind / is_overridden are pre-computed.
      // RLS on the underlying `event` table still applies through the view.
      // We over-fetch by 1 to know whether a next page exists.
      const fetchN = limit + 1;

      // Cursor predicate: lexicographic (captured_at, received_at, id) DESC.
      // Postgres doesn't have a "row-tuple <" comparison that works cleanly
      // with timestamps + uuid + nullable order columns, so we expand it.
      // Explicit ::timestamptz casts on the cursor strings — same rationale
      // as chain.ts insertEventWithChain (postgres-js + Node 22 doesn't
      // round-trip Dates cleanly on the bind path).
      const cursorClause = decoded
        ? tx`AND (
            captured_at < ${decoded.captured_at}::timestamptz
            OR (captured_at = ${decoded.captured_at}::timestamptz AND received_at < ${decoded.received_at}::timestamptz)
            OR (
              captured_at = ${decoded.captured_at}::timestamptz
              AND received_at = ${decoded.received_at}::timestamptz
              AND id < ${decoded.id}::uuid
            )
          )`
        : tx``;

      const filterClause =
        filter === 'needs_review'
          ? tx`AND effective_kind <> 'OVERRIDE'
                AND classification IS NOT NULL
                AND (classification->>'confidence')::float < 0.7
                AND NOT is_overridden`
          : filter === 'ineligible'
            ? tx`AND effective_kind = 'INELIGIBLE'`
            : filter === 'overrides'
              ? tx`AND kind = 'OVERRIDE'`
              : tx``;

      // Activity-scoped filter: events whose payload carries the
      // matching activity_id. This catches both the
      // ARTEFACT_LINKED/ARTEFACT_UNLINKED chain events (A4) and the
      // ACTIVITY_UPDATED + classified narrative events that the A6
      // register surfaces. Server-side filter so we don't ship
      // unrelated rows over the wire.
      //
      // TODO(perf): payload->>'activity_id' is a sequential scan on `event`.
      // The companion TODO in artefact-links.ts (around line 41) flagged this
      // before A6 landed — A6 deferred the work. Plan: add an expression index
      // in migrations/0017_event_activity_id_index.sql (or whatever the next
      // available migration number is when this is picked up) — likely:
      //   CREATE INDEX event_payload_activity_id_idx ON event ((payload->>'activity_id'))
      //     WHERE kind IN ('ARTEFACT_LINKED','ARTEFACT_UNLINKED',
      //                    'HYPOTHESIS','UNCERTAINTY','EXPERIMENT',
      //                    'OBSERVATION','ITERATION','NEW_KNOWLEDGE',
      //                    'ACTIVITY_UPDATED');
      // Volume threshold: re-evaluate when any single tenant has >5k events.
      const activityClause =
        activity_id !== undefined ? tx`AND payload ->> 'activity_id' = ${activity_id}` : tx``;

      // Project-scoped filter: events whose denormalised project_id
      // column matches. Direct column predicate (not a payload->>
      // extraction) — every emitter that knows the project sets this
      // column at insert time, so the index path is fast.
      // Mirrors Task 4.1's status filter and Task 4.2's claim project
      // filter — same flag, same shape, same `tx`` no-op when absent.
      const projectClause = project_id !== undefined ? tx`AND project_id = ${project_id}` : tx``;

      // Kind filter: when present, narrow to the explicit list. We
      // filter on `kind` (the canonical column) rather than
      // `effective_kind` because the register feed wants chain rows of
      // the literal kind asked for — overrides surface separately under
      // filter=overrides. Empty list / undefined ⇒ no narrowing.
      const kindClause = kind !== undefined && kind.length > 0 ? tx`AND kind IN ${tx(kind)}` : tx``;

      const rows = await tx<RawEventViewRow[]>`
        SELECT * FROM event_with_effective_kind
         WHERE subject_tenant_id = ${scopedSubjectTenantId!}
           ${cursorClause}
           ${filterClause}
           ${activityClause}
           ${projectClause}
           ${kindClause}
         ORDER BY captured_at DESC, received_at DESC, id DESC
         LIMIT ${fetchN}
      `;

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeCursor({
              captured_at:
                typeof last.captured_at === 'string'
                  ? last.captured_at
                  : last.captured_at.toISOString(),
              received_at:
                typeof last.received_at === 'string'
                  ? last.received_at
                  : last.received_at.toISOString(),
              id: last.id,
            })
          : null;

      return { events: page.map(rowToEvent), next_cursor: nextCursor };
    });
  });

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

  // -----------------------------------------------------------------------
  // GET /v1/events/:id/extraction
  // Returns extracted_content if status='complete', else { status, error? }.
  // -----------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/events/:id/extraction',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;

      const row = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<
          {
            id: string;
            extraction_status: string | null;
            extracted_content: unknown;
          }[]
        >`
          SELECT id, extraction_status, extracted_content
            FROM event
           WHERE id        = ${id}
             AND tenant_id = ${tenantId}
        `;
        return rows[0] ?? null;
      });

      if (!row) {
        return reply.status(404).send({
          error: 'event_not_found',
          message: 'No event with that id in this firm',
          requestId: req.id,
        });
      }

      if (row.extraction_status === 'complete') {
        return reply.status(200).send({
          status: 'complete',
          result: row.extracted_content,
        });
      }

      return reply.status(200).send({
        status: row.extraction_status ?? 'not_started',
        result: null,
        error:
          row.extraction_status === 'failed'
            ? (((row.extracted_content as Record<string, unknown>)?.reason as string | undefined) ??
              'Extraction failed')
            : undefined,
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /v1/events/:id/extract-content
  // Manually trigger extraction for one event. Returns { queued: true }.
  // -----------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/events/:id/extract-content',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;

      // 1. Verify event exists and is visible.
      const row = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<
          {
            id: string;
            subject_tenant_id: string;
            payload: unknown;
          }[]
        >`
          SELECT id, subject_tenant_id, payload
            FROM event
           WHERE id        = ${id}
             AND tenant_id = ${tenantId}
        `;
        return rows[0] ?? null;
      });

      if (!row) {
        return reply.status(404).send({
          error: 'event_not_found',
          message: 'No event with that id in this firm',
          requestId: req.id,
        });
      }

      // 2. Enqueue job and mark pending.
      try {
        const boss = await getBoss();
        await boss.send(DOCUMENT_EXTRACT_QUEUE, {
          event_id: id,
          tenant_id: tenantId,
          subject_tenant_id: row.subject_tenant_id,
        });
        await sql.begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
          await tx`
            UPDATE event
               SET extraction_status = 'pending'
             WHERE id        = ${id}
               AND tenant_id = ${tenantId}
          `;
        });
      } catch (e) {
        req.log.error({ err: e, event_id: id }, 'document-extract enqueue failed');
        return reply.status(503).send({
          error: 'extraction_unavailable',
          message: 'Could not enqueue extraction job; retry shortly',
          requestId: req.id,
        });
      }

      return reply.status(202).send({ queued: true });
    },
  );

  // -----------------------------------------------------------------------
  // POST /v1/proposed-activities/:event_id/accept
  // Accept one activity proposal from extracted_content. Creates the activity
  // via the existing POST /v1/activities logic.
  // -----------------------------------------------------------------------
  app.post<{ Params: { event_id: string } }>(
    '/v1/proposed-activities/:event_id/accept',
    { preHandler: requireSession },
    async (req, reply) => {
      const { event_id } = req.params;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;
      const body = req.body as { activity_index: number; claim_id?: string };

      if (typeof body.activity_index !== 'number' || !Number.isInteger(body.activity_index)) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: 'Body must include { activity_index: number }',
          requestId: req.id,
        });
      }

      // 1. Load event + extracted content under RLS.
      const row = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<
          {
            id: string;
            subject_tenant_id: string;
            extraction_status: string | null;
            extracted_content: unknown;
          }[]
        >`
          SELECT id, subject_tenant_id, extraction_status, extracted_content
            FROM event
           WHERE id        = ${event_id}
             AND tenant_id = ${tenantId}
        `;
        return rows[0] ?? null;
      });

      if (!row) {
        return reply.status(404).send({
          error: 'event_not_found',
          message: 'No event with that id in this firm',
          requestId: req.id,
        });
      }

      if (row.extraction_status !== 'complete') {
        return reply.status(422).send({
          error: 'extraction_incomplete',
          message: 'Document extraction not yet complete for this event',
          requestId: req.id,
        });
      }

      const content = row.extracted_content as {
        activities?: unknown[];
        invoices?: unknown[];
      } | null;
      const proposals = content?.activities ?? [];

      if (body.activity_index < 0 || body.activity_index >= proposals.length) {
        return reply.status(400).send({
          error: 'invalid_index',
          message: `activity_index ${body.activity_index} out of range (${proposals.length} proposals)`,
          requestId: req.id,
        });
      }

      const proposal = proposals[body.activity_index] as {
        proposed_name: string;
        proposed_kind: 'core' | 'supporting';
        hypothesis_text: string;
        technical_uncertainty: string;
        expected_outcome: string;
        confidence: number;
        rationale: string;
      };

      // 2. Find the active claim for this subject_tenant.
      const claimRow = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ id: string; project_id: string; fiscal_year: number }[]>`
          SELECT c.id, c.project_id, c.fiscal_year
            FROM claim c
           WHERE c.subject_tenant_id = ${row.subject_tenant_id}
             AND c.tenant_id         = ${tenantId}
             AND c.stage NOT IN ('submitted', 'audit_defence')
           ORDER BY c.fiscal_year DESC
           LIMIT 1
        `;
        return rows[0] ?? null;
      });

      if (!claimRow) {
        return reply.status(422).send({
          error: 'no_active_claim',
          message: 'No active claim found for this subject tenant — create a claim first',
          requestId: req.id,
        });
      }

      // 3. Generate activity code + insert activity + emit chain events.
      // fy_label: derived from claim.fiscal_year exactly as activities.ts does
      // (e.g. fiscal_year=2025 → 'FY25'). hypothesis_formed_at must be an
      // explicit timestamp — the column has no DEFAULT by design (migration 0037).
      const insertChain = insertEventWithChain;

      const code = await nextActivityCode({
        claim_id: claimRow.id,
        kind: proposal.proposed_kind,
      });

      const activityId = crypto.randomUUID();
      const now = new Date().toISOString();
      const fyLabel = `FY${(claimRow.fiscal_year - 2000).toString().padStart(2, '0')}`;
      const hypothesisFormedAt = now;

      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        await tx`
          INSERT INTO activity (
            id, tenant_id, project_id, claim_id, code, kind,
            title, hypothesis, technical_uncertainty, expected_outcome,
            fy_label, hypothesis_formed_at
          ) VALUES (
            ${activityId}::uuid,
            ${tenantId}::uuid,
            ${claimRow.project_id}::uuid,
            ${claimRow.id}::uuid,
            ${code},
            ${proposal.proposed_kind},
            ${proposal.proposed_name},
            ${proposal.hypothesis_text},
            ${proposal.technical_uncertainty},
            ${proposal.expected_outcome},
            ${fyLabel},
            ${hypothesisFormedAt}::timestamptz
          )
        `;
      });

      // Emit ACTIVITY_CREATED chain event.
      await insertChain({
        tenant_id: tenantId,
        subject_tenant_id: row.subject_tenant_id,
        kind: 'ACTIVITY_CREATED',
        payload: {
          _v: 1,
          activity_id: activityId,
          code,
          kind: proposal.proposed_kind,
          title: proposal.proposed_name,
          project_id: claimRow.project_id,
          claim_id: claimRow.id,
        },
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
        idempotency_key: null,
      });

      // Emit ARTEFACT_LINKED chain event to link source document.
      await insertChain({
        tenant_id: tenantId,
        subject_tenant_id: row.subject_tenant_id,
        kind: 'ARTEFACT_LINKED',
        payload: {
          _v: 1,
          activity_id: activityId,
          artefact_kind: 'event',
          artefact_id: event_id,
          link_reason: `Auto-linked from AI document extraction (proposal index ${body.activity_index})`,
        },
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
        idempotency_key: null,
      });

      // Emit PROPOSED_ACTIVITY_ACCEPTED chain event.
      await insertChain({
        tenant_id: tenantId,
        subject_tenant_id: row.subject_tenant_id,
        kind: 'SUPPORTING',
        payload: {
          _v: 1,
          source: 'proposed_activity_accepted',
          source_event_id: event_id,
          activity_index: body.activity_index,
          activity_id: activityId,
          activity_code: code,
        },
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
        idempotency_key: null,
      });

      return reply.status(201).send({
        activity_id: activityId,
        code,
        kind: proposal.proposed_kind,
        title: proposal.proposed_name,
        claim_id: claimRow.id,
        created_at: now,
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /v1/proposed-invoices/:event_id/accept
  // Accept one invoice proposal from extracted_content. Creates an expenditure.
  // -----------------------------------------------------------------------
  app.post<{ Params: { event_id: string } }>(
    '/v1/proposed-invoices/:event_id/accept',
    { preHandler: requireSession },
    async (req, reply) => {
      const { event_id } = req.params;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;
      const body = req.body as { invoice_index: number; project_id?: string };

      if (typeof body.invoice_index !== 'number' || !Number.isInteger(body.invoice_index)) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: 'Body must include { invoice_index: number }',
          requestId: req.id,
        });
      }

      // 1. Load event + extracted content under RLS.
      const row = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<
          {
            id: string;
            subject_tenant_id: string;
            extraction_status: string | null;
            extracted_content: unknown;
          }[]
        >`
          SELECT id, subject_tenant_id, extraction_status, extracted_content
            FROM event
           WHERE id        = ${event_id}
             AND tenant_id = ${tenantId}
        `;
        return rows[0] ?? null;
      });

      if (!row) {
        return reply.status(404).send({
          error: 'event_not_found',
          message: 'No event with that id in this firm',
          requestId: req.id,
        });
      }

      if (row.extraction_status !== 'complete') {
        return reply.status(422).send({
          error: 'extraction_incomplete',
          message: 'Document extraction not yet complete for this event',
          requestId: req.id,
        });
      }

      const content = row.extracted_content as {
        invoices?: unknown[];
      } | null;
      const proposals = content?.invoices ?? [];

      if (body.invoice_index < 0 || body.invoice_index >= proposals.length) {
        return reply.status(400).send({
          error: 'invalid_index',
          message: `invoice_index ${body.invoice_index} out of range (${proposals.length} proposals)`,
          requestId: req.id,
        });
      }

      const invoice = proposals[body.invoice_index] as {
        vendor_name: string;
        invoice_date: string;
        amount_aud: number;
        gst_aud: number | null;
        total_aud: number;
        invoice_number: string | null;
        line_items: Array<{ description: string; amount_aud: number }>;
      };

      // 2. Find the active claim.
      const claimRow = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ id: string; project_id: string }[]>`
          SELECT c.id, c.project_id
            FROM claim c
           WHERE c.subject_tenant_id = ${row.subject_tenant_id}
             AND c.tenant_id         = ${tenantId}
             AND c.stage NOT IN ('submitted', 'audit_defence')
           ORDER BY c.fiscal_year DESC
           LIMIT 1
        `;
        return rows[0] ?? null;
      });

      if (!claimRow) {
        return reply.status(422).send({
          error: 'no_active_claim',
          message: 'No active claim found — create a claim first',
          requestId: req.id,
        });
      }

      // 3. Insert expenditure + line items.
      const insertChain = insertEventWithChain;
      const expenditureId = crypto.randomUUID();

      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        await tx`
          INSERT INTO expenditure (
            id, tenant_id, subject_tenant_id, claim_id,
            vendor_name, reference,
            expenditure_date,
            total_amount, currency,
            source, ingested_at
          ) VALUES (
            ${expenditureId}::uuid,
            ${tenantId}::uuid,
            ${row.subject_tenant_id}::uuid,
            ${claimRow.id}::uuid,
            ${invoice.vendor_name},
            ${invoice.invoice_number ?? null},
            ${invoice.invoice_date}::date,
            ${String(invoice.total_aud)},
            'AUD',
            'manual',
            NOW()
          )
        `;

        // Insert line items if present.
        for (const [idx, li] of (invoice.line_items ?? []).entries()) {
          await tx`
            INSERT INTO expenditure_line (
              id, expenditure_id,
              line_number, description, amount
            ) VALUES (
              ${crypto.randomUUID()}::uuid,
              ${expenditureId}::uuid,
              ${idx + 1},
              ${li.description},
              ${String(li.amount_aud)}
            )
          `;
        }
      });

      // Emit EXPENDITURE_INGESTED chain event.
      await insertChain({
        tenant_id: tenantId,
        subject_tenant_id: row.subject_tenant_id,
        kind: 'EXPENDITURE_INGESTED',
        payload: {
          _v: 1,
          expenditure_id: expenditureId,
          source: 'manual',
          vendor_name: invoice.vendor_name,
          line_count: invoice.line_items?.length ?? 0,
        },
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
        idempotency_key: null,
      });

      // Emit PROPOSED_INVOICE_ACCEPTED chain event.
      await insertChain({
        tenant_id: tenantId,
        subject_tenant_id: row.subject_tenant_id,
        kind: 'SUPPORTING',
        payload: {
          _v: 1,
          source: 'proposed_invoice_accepted',
          source_event_id: event_id,
          invoice_index: body.invoice_index,
          expenditure_id: expenditureId,
          vendor_name: invoice.vendor_name,
          total_aud: invoice.total_aud,
        },
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
        idempotency_key: null,
      });

      return reply.status(201).send({
        expenditure_id: expenditureId,
        vendor_name: invoice.vendor_name,
        total_aud: invoice.total_aud,
        claim_id: claimRow.id,
      });
    },
  );

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

interface CursorTuple {
  captured_at: string;
  received_at: string;
  id: string;
}

/**
 * Encode a cursor tuple as opaque base64 JSON. Clients shouldn't introspect
 * — the format is internal and can change without bumping the API contract
 * since cursors are returned by us and passed back as-is.
 */
function encodeCursor(t: CursorTuple): string {
  return Buffer.from(JSON.stringify(t), 'utf8').toString('base64url');
}

/**
 * Decode an opaque cursor. Returns null on any parse error so the route can
 * surface a 400; never throws (untrusted input). Validates the three field
 * shapes minimally so a corrupted cursor doesn't slip into the WHERE clause.
 */
function decodeCursor(s: string): CursorTuple | null {
  try {
    const json = Buffer.from(s, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Partial<CursorTuple>;
    if (
      typeof parsed.captured_at !== 'string' ||
      typeof parsed.received_at !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      return null;
    }
    return {
      captured_at: parsed.captured_at,
      received_at: parsed.received_at,
      id: parsed.id,
    };
  } catch {
    return null;
  }
}
