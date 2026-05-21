/**
 * Server-side projection of the EXPENDITURE_* event chain into
 * a current_mapping shape per expenditure.
 *
 * Mirror of apps/web/src/app/claims/[claim_id]/_lib/expenditure-projection.ts
 * — a parity test asserts identical output for the same input chain.
 *
 * The chain is the system of record; this helper just walks events in
 * captured_at DESC order and picks the latest parent-level mapping
 * event. EXPENDITURE_LINE_MAPPED is out of scope (line-level granularity
 * is a separate concern).
 */

export interface SingleMapping {
  kind: 'single';
  activity_id: string;
  activity_code: string;
  activity_title: string;
}

export interface ApportionedMapping {
  kind: 'apportioned';
  allocations: Array<{
    activity_id: string;
    activity_code: string;
    activity_title: string;
    percentage: number;
  }>;
}

export type CurrentMapping = SingleMapping | ApportionedMapping | null;

/**
 * Input event shape for the projection. Only the fields the projection
 * actually reads — keeps the helper testable without dragging the full
 * `event` row schema in.
 */
export interface MappingChainEvent {
  kind: 'EXPENDITURE_MAPPED' | 'EXPENDITURE_APPORTIONED' | 'EXPENDITURE_UNMAPPED';
  payload: Record<string, unknown>;
  captured_at: string; // ISO8601
  id: string; // tiebreaker for same-instant events
}

/**
 * Walk events for ONE expenditure and return the current mapping.
 * Caller must pre-filter events by expenditure_id.
 */
export function projectMapping(events: MappingChainEvent[]): CurrentMapping {
  if (events.length === 0) return null;
  // Latest first by (captured_at, id) — descending.
  const sorted = [...events].sort((a, b) => {
    if (a.captured_at !== b.captured_at) return a.captured_at < b.captured_at ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
  const latest = sorted[0]!;
  if (latest.kind === 'EXPENDITURE_UNMAPPED') return null;
  if (latest.kind === 'EXPENDITURE_MAPPED') {
    const p = latest.payload;
    return {
      kind: 'single',
      activity_id: String(p['activity_id']),
      activity_code: String(p['activity_code']),
      activity_title: String(p['activity_title']),
    };
  }
  // EXPENDITURE_APPORTIONED
  const allocations = (latest.payload['allocations'] as Array<Record<string, unknown>>) ?? [];
  return {
    kind: 'apportioned',
    allocations: allocations.map((a) => ({
      activity_id: String(a['activity_id']),
      activity_code: String(a['activity_code']),
      activity_title: String(a['activity_title']),
      percentage: Number(a['percentage']),
    })),
  };
}
