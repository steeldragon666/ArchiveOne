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
 * Subset of `Event` that the projection needs. Mirrors the captured_at
 * + payload columns of the `event` row over the wire (see
 * `packages/schemas/src/event.ts`). Typed loosely on `kind` because the
 * projection intentionally ignores rows that aren't EXPENDITURE_MAPPED
 * — the caller can pass the full event stream and the helper filters
 * inline.
 */
export interface ProjectableEvent {
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
 */
export function projectMappingFromEvents(
  events: ReadonlyArray<ProjectableEvent>,
): Record<string, PlannedExpenditureMappedPayload> {
  const out: Record<string, PlannedExpenditureMappedPayload> = {};
  for (const ev of events) {
    if (ev.kind !== 'EXPENDITURE_MAPPED') continue;
    const existing = out[ev.payload.expenditure_id];
    // Later captured_at wins. Equal timestamps tie to the latter
    // input (insert order) — stable for tests, fine for production
    // because the chain assigns distinct captured_ats.
    if (!existing || ev.captured_at >= existing.mapped_at) {
      out[ev.payload.expenditure_id] = ev.payload;
    }
  }
  return out;
}
