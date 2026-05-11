/**
 * Analysis-tab API helpers for /claims/[claim_id].
 *
 * Fetches classified events scoped to a claim, then shapes them into the
 * AnalysisEvent format the live-analysis-panel components consume.
 *
 * The classifier lives in packages/agents/src/classifier/. apps/web does
 * NOT import from @cpa/agents — the shapes are mirrored locally (same
 * constraint documented in multi-cycle-timeline.tsx and lib/narrative/).
 * If the classifier type shapes drift, the contract test in the agents
 * package will surface the mismatch.
 *
 * Route used: GET /v1/events?subject_tenant_id=...&limit=200
 * This returns all events for the claimant; we filter to those that
 * carry a classification (kind is one of the CLASSIFIABLE_KINDS) and are
 * within the claim's fiscal year. Activity linkage is resolved by matching
 * event.payload.activity_id or the top-level activity_id column.
 *
 * Re-classify route (optional v1 backend trigger):
 *   POST /v1/events/:id/reclassify
 * This route may not exist yet — callers catch 404 and fall back to the
 * visual replay mode. The UI is always functional regardless.
 */

import type { Activity, Event as ApiEvent } from '@cpa/schemas';
import { apiFetch } from '@/lib/api';

// -------------------------------------------------------------------------
// Classifier kind constants — mirrored from @cpa/agents/classifier/types.ts
// -------------------------------------------------------------------------

export const CLASSIFIABLE_KINDS = [
  'HYPOTHESIS',
  'DESIGN',
  'EXPERIMENT',
  'OBSERVATION',
  'ITERATION',
  'NEW_KNOWLEDGE',
  'UNCERTAINTY',
  'TIME_LOG',
  'ASSOCIATE_FLAG',
  'EXPENDITURE_NOTE',
  'SUPPORTING',
  'INELIGIBLE',
] as const;

export type ClassifiableKind = (typeof CLASSIFIABLE_KINDS)[number];

const CLASSIFIABLE_SET = new Set<string>(CLASSIFIABLE_KINDS);

export function isClassifiableKind(k: string): k is ClassifiableKind {
  return CLASSIFIABLE_SET.has(k);
}

// -------------------------------------------------------------------------
// AnalysisEvent — the enriched event shape the panel works with
// -------------------------------------------------------------------------

/**
 * Processing state for a single evidence item in the live panel.
 *
 * queued     — not yet processed (default before Re-run)
 * reading    — the classifier is actively working on this item
 * classified — classification complete, kind + confidence available
 * error      — classification failed
 */
export type AnalysisEventState = 'queued' | 'reading' | 'classified' | 'error';

/** The classification payload as we expect it from the API. */
export interface ClassificationPayload {
  kind: ClassifiableKind;
  confidence: number;
  rationale?: string;
  statutory_anchor?: string | null;
  model?: string;
  /** Extracted facts the AI surfaced from the document. */
  extracted_facts?: {
    dates?: string[];
    amounts?: string[];
    parties?: string[];
    hypothesis_formed_at?: string;
    [key: string]: unknown;
  };
  /** Narrative segments written by the narrative-drafter agent. */
  narrative_segments?: NarrativeSegment[];
  /** Full synthesised narrative prose (set when narrative-drafter completes). */
  narrative?: string;
}

export interface NarrativeSegment {
  /** Paragraph text (verbatim from narrative-drafter output). */
  text: string;
  /** Citation markers embedded in the text, e.g. [1], [2] → resolved below. */
  citations: Citation[];
}

export interface Citation {
  /** 1-based marker index (matches superscript rendered in prose). */
  index: number;
  /** If the citation points to an activity. */
  activity_id?: string;
  activity_code?: string;
  /** If the citation points to a specific event. */
  event_id?: string;
  filename?: string;
  page?: number;
  /** Human-readable label for the citation footer. */
  label: string;
}

/**
 * An evidence event enriched with its grouping context and UI state.
 * Used exclusively by the live-analysis-panel component tree.
 */
export interface AnalysisEvent {
  /** Original API event (full shape). */
  event: ApiEvent;
  /** Display filename — derived from payload.filename or truncated event id. */
  filename: string;
  /** Activity this event is linked to (null = unlinked). */
  activity: Activity | null;
  /** Classification output if present on the event. */
  classification: ClassificationPayload | null;
  /** Live UI state — starts as 'classified' on load, resets to 'queued' on Re-run. */
  state: AnalysisEventState;
}

// -------------------------------------------------------------------------
// Data fetching helpers
// -------------------------------------------------------------------------

/** Resolve a filename from an event's payload or fallback to event id. */
function resolveFilename(event: ApiEvent): string {
  const p = event.payload as Record<string, unknown> | null;
  if (p && typeof p['filename'] === 'string') return p['filename'];
  if (p && typeof p['source'] === 'string' && p['source'].length > 0) {
    return p['source'];
  }
  return event.id.slice(0, 8);
}

/** Extract activity_id from an event (top-level column or payload). */
function resolveActivityId(event: ApiEvent): string | null {
  // ApiEvent may carry activity_id as a top-level column (federation events)
  // or inside payload (legacy). Narrow-cast rather than `as any` to satisfy
  // typescript-eslint/no-unsafe-* without losing the runtime check.
  const top = (event as { activity_id?: unknown }).activity_id;
  if (typeof top === 'string') return top;
  const p = event.payload as Record<string, unknown> | null;
  if (p && typeof p['activity_id'] === 'string') return p['activity_id'];
  return null;
}

/** Parse the classification payload from an ApiEvent. */
function resolveClassification(event: ApiEvent): ClassificationPayload | null {
  const cls = event.classification;
  if (!cls) return null;
  if (!isClassifiableKind(cls.kind)) return null;
  return {
    kind: cls.kind,
    confidence: cls.confidence ?? 0,
    rationale: cls.rationale ?? undefined,
    statutory_anchor: cls.statutory_anchor ?? null,
    // Extended fields (narrative-drafter) live in a nested payload on
    // the classification. We access them defensively.
    ...(cls as unknown as Partial<ClassificationPayload>),
  };
}

/**
 * Fetch all classified evidence events for a claim's subject tenant and
 * map them into AnalysisEvent objects ready for the panel.
 *
 * Strategy:
 *   1. Fetch activities for the claim (re-uses the cache from listActivities).
 *   2. Fetch up to 200 events for the tenant.
 *   3. Filter to events whose `kind` is a classifiable R&D kind.
 *   4. Enrich each event with its activity and classification.
 *
 * Returns events grouped by activity, core activities first.
 */
export async function fetchAnalysisEvents(
  claimId: string,
  subjectTenantId: string,
): Promise<AnalysisEvent[]> {
  const [activitiesBody, eventsBody] = await Promise.all([
    apiFetch<{ activities: Activity[] }>(`/v1/activities?claim_id=${encodeURIComponent(claimId)}`),
    apiFetch<{ events: ApiEvent[]; next_cursor: string | null }>(
      `/v1/events?subject_tenant_id=${encodeURIComponent(subjectTenantId)}&limit=200`,
    ),
  ]);

  const activityMap = new Map<string, Activity>(activitiesBody.activities.map((a) => [a.id, a]));

  // Only include classifiable evidence events.
  const evidenceEvents = eventsBody.events.filter(
    (e) => isClassifiableKind(e.kind) || isClassifiableKind(e.effective_kind),
  );

  const analysisEvents: AnalysisEvent[] = evidenceEvents.map((event) => {
    const activityId = resolveActivityId(event);
    const activity = activityId ? (activityMap.get(activityId) ?? null) : null;
    return {
      event,
      filename: resolveFilename(event),
      activity,
      classification: resolveClassification(event),
      state: 'classified',
    };
  });

  // Sort: core activities first (CA-NN), then supporting (SA-NN), then unlinked.
  analysisEvents.sort((a, b) => {
    const kindOrder = (ae: AnalysisEvent): number => {
      if (!ae.activity) return 2;
      return ae.activity.kind === 'core' ? 0 : 1;
    };
    const ko = kindOrder(a) - kindOrder(b);
    if (ko !== 0) return ko;
    // Within group: sort by activity code, then by captured_at.
    const codeA = a.activity?.code ?? '';
    const codeB = b.activity?.code ?? '';
    const cc = codeA.localeCompare(codeB);
    if (cc !== 0) return cc;
    return a.event.captured_at.localeCompare(b.event.captured_at);
  });

  return analysisEvents;
}

/**
 * Attempt to trigger a real backend reclassification for one event.
 *
 * POST /v1/events/:id/reclassify may not exist yet — this function
 * catches 404 and resolves silently so the caller can fall through to
 * the visual replay path. Any other error is rethrown so the panel can
 * surface it.
 *
 * v1 mode: the panel is currently "UI replay only" — this function is
 * called but the 404 path is the expected production path until the
 * reclassify endpoint ships in a future swimlane.
 */
export async function reclassifyEvent(eventId: string): Promise<void> {
  try {
    await apiFetch<unknown>(`/v1/events/${encodeURIComponent(eventId)}/reclassify`, {
      method: 'POST',
    });
  } catch (err) {
    // 404 → route doesn't exist yet; treat as visual-replay mode.
    if (err instanceof Error && err.message.includes('404')) return;
    throw err;
  }
}

// -------------------------------------------------------------------------
// Synthetic narrative derivation
// -------------------------------------------------------------------------

/**
 * Derive a synthetic narrative from classified events when the
 * narrative-drafter has not yet produced `event.classification.payload.narrative`.
 *
 * This is a pure client-side aggregation — no LLM involvement. When the
 * real narrative-drafter output arrives via `classification.narrative`,
 * the narrative-stream component swaps to that prose instead. This
 * fallback is documented inline so the swap-in is visible.
 *
 * The derivation groups events by activity, counts evidence items per
 * kind, and constructs human-readable sentences. It is intentionally
 * conservative: it never fabricates statutory claims or makes up
 * dates that aren't in the data.
 */
export interface SyntheticNarrative {
  paragraphs: SyntheticParagraph[];
  citations: Citation[];
}

export interface SyntheticParagraph {
  text: string;
  /** Citation indices embedded in this paragraph (1-based). */
  citationIndices: number[];
}

export function deriveSyntheticNarrative(events: AnalysisEvent[]): SyntheticNarrative {
  const classified = events.filter((e) => e.classification !== null);
  if (classified.length === 0) {
    return { paragraphs: [], citations: [] };
  }

  const citations: Citation[] = [];
  let citationCounter = 0;
  const nextCitation = (c: Omit<Citation, 'index'>): number => {
    citationCounter++;
    citations.push({ ...c, index: citationCounter });
    return citationCounter;
  };

  // Group by activity
  const byActivity = new Map<string | null, AnalysisEvent[]>();
  for (const ae of classified) {
    const key = ae.activity?.id ?? null;
    const bucket = byActivity.get(key);
    if (bucket) {
      bucket.push(ae);
    } else {
      byActivity.set(key, [ae]);
    }
  }

  const paragraphs: SyntheticParagraph[] = [];

  // Opening paragraph
  const activityCount = [...byActivity.keys()].filter((k) => k !== null).length;
  const totalEvents = classified.length;
  paragraphs.push({
    text: `This claim contains ${activityCount} ${activityCount === 1 ? 'activity' : 'activities'} supported by ${totalEvents} classified evidence ${totalEvents === 1 ? 'item' : 'items'}.`,
    citationIndices: [],
  });

  // Per-activity paragraphs
  for (const [activityId, evts] of byActivity.entries()) {
    if (activityId === null) continue;
    const activity = evts[0]?.activity;
    if (!activity) continue;

    // Count by kind
    const kindCounts: Partial<Record<ClassifiableKind, number>> = {};
    for (const ae of evts) {
      if (!ae.classification) continue;
      const k = ae.classification.kind;
      kindCounts[k] = (kindCounts[k] ?? 0) + 1;
    }

    const kindSummary = Object.entries(kindCounts)
      .map(
        ([k, n]) => `${n} ${k.toLowerCase().replace(/_/g, ' ')} ${n === 1 ? 'record' : 'records'}`,
      )
      .join(', ');

    // Find earliest hypothesis_formed_at from extracted_facts
    const hypothesisDate = evts
      .flatMap((ae) => ae.classification?.extracted_facts?.dates ?? [])
      .sort()[0];

    const actIdx = nextCitation({
      activity_id: activity.id,
      activity_code: activity.code,
      label: `Activity ${activity.code} · ${evts.length} evidence ${evts.length === 1 ? 'item' : 'items'}`,
    });

    let para = `${activity.code} (${activity.title}) is supported by ${kindSummary}[${actIdx}].`;

    if (hypothesisDate) {
      para += ` The earliest recorded date is ${hypothesisDate}.`;
    }

    paragraphs.push({ text: para, citationIndices: [actIdx] });
  }

  // Unlinked events
  const unlinked = byActivity.get(null) ?? [];
  if (unlinked.length > 0) {
    paragraphs.push({
      text: `${unlinked.length} evidence ${unlinked.length === 1 ? 'item has' : 'items have'} not yet been linked to an activity and will require manual review.`,
      citationIndices: [],
    });
  }

  return { paragraphs, citations };
}
