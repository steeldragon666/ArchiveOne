import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import {
  computeIdempotencyKey,
  lookupCache,
  makeClassifier,
  withAgentSpan,
  writeCache,
  type Classifier,
  type ClassifierOutput,
} from '@cpa/agents';
import { insertEventWithChain } from '@cpa/db';
import { sql } from '@cpa/db/client';
import {
  createEventBody,
  type Classification,
  type Event as ApiEvent,
} from '@cpa/schemas';

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

    return reply.status(201).send({ event: rowToEvent(fresh) });
  });
}
