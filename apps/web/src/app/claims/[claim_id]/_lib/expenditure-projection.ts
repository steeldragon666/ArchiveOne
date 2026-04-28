/**
 * `EXPENDITURE_MAPPED` event projection — pure helper.
 *
 * Architecture context (controller decision, P4 plan §C5):
 *
 *   Mapping persistence is event-sourced. The eventual A-swimlane
 *   endpoint posts an `EXPENDITURE_MAPPED` event via
 *   `POST /v1/expenditures/:id/map`. Current mapping state is the
 *   "latest event per expenditure" projection.
 *
 * This helper is the pure projection function. It's implemented and
 * tested today — even though C5's only data source is the in-memory
 * stub in `expenditure-stub.ts` — so swapping the stub for a real
 * server feed is a wiring change, not a logic change. The projection
 * shape (latest-event-wins, keyed by `expenditure_id`) is stable
 * regardless of where the events come from.
 *
 * Adding the `EXPENDITURE_MAPPED` event kind to
 * `packages/schemas/src/event.ts` is deliberately deferred to
 * A-swimlane (preempting it could conflict with the API design). For
 * now this module operates against a local payload shape that mirrors
 * the planned wire format.
 */

/**
 * Local mirror of the planned `EXPENDITURE_MAPPED` event payload. Kept
 * in this module (not in `@cpa/schemas`) so C5 doesn't preempt the
 * schema decision in A-swimlane — when the schema lands, replace this
 * type with the imported one and delete the local declaration.
 *
 * Field shape matches the existing `EXPENDITURE_LINE_MAPPED` payload
 * style (see `packages/schemas/src/event.ts`) so the future schema
 * addition is a small, mechanical change.
 */
export interface PlannedExpenditureMappedPayload {
  expenditure_id: string;
  activity_id: string;
  activity_code: string;
  activity_title: string;
  /** ISO-8601 — taken from the event's `captured_at`. */
  mapped_at: string;
}

/**
 * Subset of `Event` that the projection needs. Mirrors the id +
 * captured_at + payload columns of the `event` row over the wire (see
 * `packages/schemas/src/event.ts`). Typed loosely on `kind` because the
 * projection intentionally ignores rows that aren't EXPENDITURE_MAPPED
 * — the caller can pass the full event stream and the helper filters
 * inline.
 *
 * `id` is used as a deterministic tie-breaker when two events share the
 * same `captured_at` (see `projectMappingFromEvents` for details).
 */
export interface ProjectableEvent {
  id: string;
  kind: string;
  captured_at: string;
  payload: PlannedExpenditureMappedPayload;
}

/**
 * Roll a stream of EXPENDITURE_MAPPED events into a "latest mapping
 * per expenditure" map keyed by `expenditure_id`. Latest is determined
 * by `captured_at` (server-canonical timestamp, monotonically increasing
 * per the chain).
 *
 * Pure — no mutation of the input — and order-insensitive (a re-ordered
 * input produces the same projection). The helper is a no-op against
 * stubs today; once A-swimlane ships, the caller passes
 * `events.filter(e => e.kind === 'EXPENDITURE_MAPPED')` as-is.
 *
 * Scope: this projection covers ONLY parent-level mapping (kind ===
 * 'EXPENDITURE_MAPPED'). It does NOT consume kind ===
 * 'EXPENDITURE_LINE_MAPPED' events, which represent line-item-level
 * mapping emitted by the apportionment / rule-engine surface (see F5+
 * — `packages/schemas/src/event.ts` defines that payload).
 *
 * Composition: an expenditure can have BOTH a parent mapping (this
 * projection) and one or more line-level mappings (a separate
 * projection). The row-level UI is responsible for composing them —
 * typically:
 *   - if any line is mapped, show "partially mapped" or list the line
 *     activities
 *   - else if a parent mapping exists, show that
 *   - else "unmapped"
 *
 * Today (C5) the projection only operates on stub data that emits
 * parent-level events. The composition logic above is documented here
 * so that when A-swimlane lands real EXPENDITURE_MAPPED events AND F5+
 * lands real EXPENDITURE_LINE_MAPPED events, the row-UI knows to
 * compose both projections rather than choosing one.
 *
 * Tie-breaker: when two events share the same `captured_at` (rare in
 * production — the chain assigns distinct timestamps — but achievable
 * via backfills and deterministic tests), the lexicographically higher
 * event id wins. This makes the projection input-order-insensitive
 * even at the equality boundary.
 */
export function projectMappingFromEvents(
  events: ReadonlyArray<ProjectableEvent>,
): Record<string, PlannedExpenditureMappedPayload> {
  // Track the winning event per expenditure so the tie-breaker on `id`
  // has something to compare against. The output map only stores
  // payloads, but internally we need the event metadata too.
  const winners: Record<string, ProjectableEvent> = {};
  for (const ev of events) {
    if (ev.kind !== 'EXPENDITURE_MAPPED') continue;
    const current = winners[ev.payload.expenditure_id];
    if (isNewer(ev, current)) {
      winners[ev.payload.expenditure_id] = ev;
    }
  }
  const out: Record<string, PlannedExpenditureMappedPayload> = {};
  for (const [expenditure_id, ev] of Object.entries(winners)) {
    out[expenditure_id] = ev.payload;
  }
  return out;
}

/**
 * Pick the latest event by `captured_at`; break ties by event id
 * (lexicographic). The chain assigns distinct captured_ats in practice,
 * but tests and backfills can produce equal timestamps — without a
 * stable tie-breaker the projection becomes input-order-dependent.
 */
function isNewer(candidate: ProjectableEvent, current: ProjectableEvent | undefined): boolean {
  if (current === undefined) return true;
  if (candidate.captured_at !== current.captured_at) {
    return candidate.captured_at > current.captured_at;
  }
  return candidate.id > current.id; // lexicographic id breaks the tie
}
