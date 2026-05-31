import crypto from 'node:crypto';
import { z } from 'zod';
import { sql } from '@cpa/db/client';
import { canonicalJsonStringify } from '@cpa/db';
import type { CompressedEvent, NarrativeSegment, SectionKind } from '@cpa/agents/narrative-drafter';

/**
 * Shared types, Zod schemas, constants, and DB helpers for the narrative
 * route family (narrative-initial + narrative-regenerate).
 *
 * Extracted from the original monolithic narrative.ts so the sibling
 * route files share one canonical set of loaders / hashers. Behaviour is
 * unchanged from the pre-split monolith.
 */

// ---------------------------------------------------------------------------
// Body schemas
// ---------------------------------------------------------------------------

export const NarrativeRequestBody = z
  .object({
    /** Optional client-side dedup token. Stored on `narrative_draft.idempotency_key`
     *  for the section_kind=new_knowledge row only (the rest mirror it).
     */
    client_request_id: z.string().min(1).max(200).optional(),
  })
  .strict()
  .or(z.undefined()); // empty body is fine

// Same body shape for regenerate. Kept as a separate name for readability
// at the route handler call sites.
export const RegenerateRequestBody = NarrativeRequestBody;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROMPT_VERSION = 'draft-narrative@1.0.0';

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/**
 * Activity row shape after the project join. RLS-scoped via the
 * tenant GUC — cross-firm rows are invisible.
 */
export type ActivityRow = {
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

export type ExistingDraftRow = {
  id: string;
  section_kind: SectionKind;
  current_version: number;
  segments: NarrativeSegment[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function loadActivityForTenant(
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
export function deriveAuFiscalYear(startedAt: Date | string): number {
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
export async function loadClusteredEventIds(
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
export function truncateToFiftyWords(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.split(/\s+/).slice(0, 50).join(' ');
}

/**
 * Hydrate compressed events for the model. Per spec: summary = first
 * 50 words of `payload.text` or `payload.raw_text`. Returns rows in the
 * order of `eventIds` (preserves the cluster's intended ordering even
 * though postgres doesn't guarantee it).
 */
export async function loadCompressedEvents(
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
export async function loadExistingInitialDraft(
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
 * Load all four current narrative_draft rows for an activity. Returns
 * `null` if NO rows exist (regen has no draft to regenerate against);
 * returns the rows otherwise (including the partial case where < 4 rows
 * exist — in practice the initial-generation endpoint always writes all
 * four atomically, so a partial row set is an integrity bug, but the
 * regen path defensively treats any row set with the requested section
 * present as "draft exists" and falls back to empty-segment defaults
 * for missing sections in `existing_sections`).
 */
export async function loadAllDraftSectionsForActivity(
  activityId: string,
  tenantId: string,
): Promise<ExistingDraftRow[]> {
  return await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    const rows = await tx<ExistingDraftRow[]>`
      SELECT id, section_kind, current_version, segments
        FROM narrative_draft
       WHERE tenant_id = ${tenantId}
         AND activity_id = ${activityId}
    `;
    return rows;
  });
}

/**
 * Idempotency probe for regen: a previous successful regen with the same
 * `client_request_id` stored that string verbatim on the matching
 * `narrative_draft` row's `idempotency_key` column (the live mutable
 * surface) AND issued one NARRATIVE_DRAFTED chain event for the new
 * version. We use the live row as the probe key (the chain event's
 * `idempotency_key` column is sha256-only — see migration 0006's
 * `event_idempotency_key_format` CHECK), then look up the chain event
 * for the resulting (draft_id, version) pair.
 *
 * Returns null when no prior matching regen exists. The probe is
 * deliberately scoped to `current_version >= 2` so a stale initial
 * draft whose `narrative_draft.idempotency_key` happens to equal the
 * caller's `client_request_id` (impossible in practice — initial gen
 * sets that on the new_knowledge row only, and that's the initial-gen
 * idempotency key) cannot mask a real regen request.
 */
export async function loadExistingRegen(
  activityId: string,
  sectionKind: SectionKind,
  tenantId: string,
  clientRequestId: string,
): Promise<{ draft_id: string; version: number; event_id: string } | null> {
  return await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    const draftRows = await tx<{ id: string; current_version: number }[]>`
      SELECT id, current_version
        FROM narrative_draft
       WHERE tenant_id = ${tenantId}
         AND activity_id = ${activityId}
         AND section_kind = ${sectionKind}
         AND idempotency_key = ${clientRequestId}
         AND current_version >= 2
       LIMIT 1
    `;
    const draft = draftRows[0];
    if (!draft) return null;
    const evtRows = await tx<{ id: string }[]>`
      SELECT id
        FROM event
       WHERE tenant_id = ${tenantId}
         AND kind = 'NARRATIVE_DRAFTED'
         AND (payload ->> 'narrative_draft_id') = ${draft.id}
         AND ((payload ->> 'version')::int) = ${draft.current_version}
       ORDER BY captured_at DESC, received_at DESC, id DESC
       LIMIT 1
    `;
    return {
      draft_id: draft.id,
      version: draft.current_version,
      event_id: evtRows[0]?.id ?? '',
    };
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
export function hashSectionSegments(segments: readonly NarrativeSegment[]): string {
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
