import type { Activity, Claim, Uuid } from '@cpa/schemas';
import { filterExpenditures, STUB_EXPENDITURES, type ExpenditureRow } from './expenditure-stub';
import { isValidAllocationSet, type ValidatedAllocation } from './apportionment';
import type { ExpenditureFilter } from './url-params';
import { apiFetch } from '@/lib/api';

/**
 * Activity extended with the narrative-approval review metadata.
 *
 * The base `Activity` type in `@cpa/schemas` does not yet include the three
 * columns added by migration 0079 (`needs_review`, `proposal_confidence`,
 * `proposed_from_event_id`). They land on the wire once the backend route
 * starts SELECTing them. Until then, both fields are `undefined` on existing
 * rows and the chip simply doesn't render — no UI breakage.
 *
 * TODO: once `@cpa/schemas`'s Activity zod schema picks up these fields,
 * delete this local type and import directly.
 */
export interface ActivityWithReview extends Activity {
  needs_review?: boolean;
  proposal_confidence?: number | null;
  proposed_from_event_id?: string | null;
}

/**
 * Claim-detail-scoped fetch helpers.
 *
 * Currently a stub: Swimlane A's A2 task delivers `GET /v1/claims/:id`
 * and A3 delivers `GET /v1/activities?claim_id=...`, but C4 ships ahead
 * of both. Until then, these resolve to a fixture-shaped object / empty
 * list so the tab shell + data wiring is exercisable end-to-end.
 *
 * Swap the bodies for real `apiFetch(...)` calls once A2/A3 ship — the
 * signatures already match the eventual API contracts so it'll be a
 * one-liner per function. Mirrors the C2 stub pattern in
 * `apps/web/src/app/pipeline/_lib/api.ts`.
 */

export async function getClaim(id: string): Promise<Claim> {
  // GET /v1/claims/:id — returns `{ claim, counts }`; we unwrap to Claim.
  // (Earlier this was a hard-coded fixture pre-A2; the real route landed
  // and the wire shape stabilised, so it's now a thin pass-through.)
  const body = await apiFetch<{ claim: Claim }>(`/v1/claims/${id}`);
  return body.claim;
}

/**
 * GET /v1/activities?claim_id=...
 *
 * Real endpoint, RLS-scoped. Returns every activity row for this claim, sorted
 * by `code` ASC (CA-001, CA-002, ..., SA-001, SA-002, ...). The wire shape is
 * `{ activities: Activity[] }` per the route handler in
 * `apps/api/src/routes/activities.ts`.
 *
 * Once migration 0079 lands and the SELECT picks up `needs_review`,
 * `proposal_confidence`, `proposed_from_event_id`, those fields will arrive
 * automatically and the 🤖 review chip on the Activities tab will start
 * rendering for low-confidence AI-auto-created rows. No frontend changes
 * needed at that point.
 */
export async function listActivities(claimId: string): Promise<ActivityWithReview[]> {
  const body = await apiFetch<{ activities: ActivityWithReview[] }>(
    `/v1/activities?claim_id=${claimId}`,
  );
  return body.activities;
}

/**
 * List expenditures for a claim, optionally filtered by mapping state.
 *
 * TODO(A?-mapping): replace with `apiFetch<{ expenditures: ExpenditureRow[] }>(
 *   `/v1/claims/${claimId}/expenditures?filter=${filter}`)` once the
 * endpoint ships. Likely wire shape:
 *
 *   GET /v1/claims/:id/expenditures?filter=all|unmapped|mapped
 *   200 OK {
 *     expenditures: ExpenditureRow[]  // joined: source row + xero_contact + projected current_mapping
 *   }
 *
 * Until then we read from the in-memory fixture and apply the filter
 * client-side so the tab is exercisable end-to-end.
 *
 * `current_mapping` on each row is the projection of the latest
 * `EXPENDITURE_MAPPED` event for that expenditure (see
 * `expenditure-projection.ts`). Today the fixture pre-populates a
 * couple of mapped rows directly; once A-swimlane ships, the projection
 * runs server-side and the row arrives pre-shaped.
 */
export async function listExpenditures(
  _claimId: string,
  filter: ExpenditureFilter,
): Promise<ExpenditureRow[]> {
  // TODO(A?-mapping): wire to GET /v1/claims/:id/expenditures.
  return Promise.resolve(filterExpenditures(STUB_EXPENDITURES, filter));
}

/**
 * Map an expenditure to an activity within the current claim. Stub.
 *
 * TODO(A?-mapping): this represents what will become an
 * `EXPENDITURE_MAPPED` event posted via:
 *
 *   POST /v1/expenditures/:id/map
 *   Body: { activity_id: Uuid }
 *   200 OK: { event: Event }   // the appended chain entry
 *
 * Planned event payload (mirror in packages/schemas/src/event.ts when
 * A-swimlane lands; do NOT add the schema here — preempting it could
 * conflict with the eventual API design):
 *
 *   ExpenditureMappedPayload = {
 *     expenditure_id: Uuid,
 *     activity_id: Uuid,
 *     activity_code: string,
 *     activity_title: string,
 *     // mapped_at is implicit — it's the event's captured_at timestamp.
 *   }
 *
 * Why an event and not a column update? Mapping is an audit-relevant
 * decision and may be re-mapped multiple times (consultant changes
 * their mind, or the rule engine in F5 disagrees with a manual map).
 * The chain is the system of record; the row's `current_mapping`
 * column is a projection that can always be rebuilt by replaying
 * EXPENDITURE_MAPPED events filtered to this expenditure.
 *
 * Why not piggyback on `EXPENDITURE_LINE_MAPPED` (which already exists
 * in event.ts)? That event is keyed by `expenditure_line_id`, but
 * C5's surface maps the parent expenditure as a single unit (no
 * line-item splitting yet). Splitting is a P5+ concern; until then a
 * dedicated `EXPENDITURE_MAPPED` keyed by the parent id is cleaner.
 *
 * The stub resolves successfully — no error simulation. The
 * Promise.allSettled aggregation in expenditure-tab.tsx is exercised
 * regardless because the optimistic / revert paths still run.
 */
export async function mapExpenditure(_expenditureId: string, _activityId: string): Promise<void> {
  // TODO(A?-mapping): wire to POST /v1/expenditures/:id/map.
  return Promise.resolve();
}

/**
 * TODO(A?-apportion): Submits an apportionment for a single expenditure
 * across multiple activities. The future endpoint is:
 *
 *   POST /v1/expenditures/:id/apportion
 *   Body: {
 *     allocations: [
 *       { activity_id: Uuid, percentage: number },
 *       ...
 *     ]
 *   }
 *
 * Server-side validation:
 *   - sum of percentages = 100.000 (±0.001 tolerance — must match the
 *     `SUM_TOLERANCE` constant in `apportionment.ts` so the client's
 *     disabled-submit and the server's reject align)
 *   - every percentage strictly > 0 (zero-rows would be nonsensical)
 *   - 1 ≤ allocations.length ≤ 5 (matches `MAX_ALLOCATIONS`)
 *   - every activity_id resolves to an Activity scoped to the same
 *     claim as the expenditure (server-side join)
 *
 * Emits an `EXPENDITURE_APPORTIONED` event (NEW kind — coordinate with
 * A-swimlane to add it to packages/schemas/src/event.ts; do NOT add the
 * event kind in this commit). Planned payload:
 *
 *   ExpenditureApportionedPayload = {
 *     expenditure_id: Uuid,
 *     allocations: [
 *       {
 *         activity_id: Uuid,
 *         activity_code: string,        // denormalised for projection display
 *         activity_title: string,       // denormalised for projection display
 *         percentage: number,           // 0 < pct ≤ 100
 *       },
 *       ...
 *     ],
 *     mapped_by_user_id: Uuid,          // from the auth context
 *     // apportioned_at is implicit — taken from the event's captured_at.
 *   }
 *
 * Why a separate event kind (not piggyback on EXPENDITURE_MAPPED with
 * an array)? Two reasons:
 *   1. EXPENDITURE_MAPPED is keyed to a single activity_id; reshaping
 *      it would break the projection helper (and the line-mapped
 *      sibling). A new kind keeps each event's payload single-purpose.
 *   2. Apportionment is a distinct user intent from "single mapping" —
 *      the audit story needs to differentiate "this consultant said
 *      this is one activity" from "this consultant said it's a split."
 *
 * Composition with existing events: see `expenditure-projection.ts`
 * JSDoc for the parent/line/apportionment composition rules.
 * EXPENDITURE_APPORTIONED is a third aggregate that takes precedence
 * over parent EXPENDITURE_MAPPED but is overridden by line-level
 * EXPENDITURE_LINE_MAPPED (which is the most specific).
 *
 * Stub implementation: simulates a small latency (so the dialog's
 * submit-disabled state is visible during dev), validates the same
 * shape the future server will reject on (so misuse from the dialog
 * is caught locally), and resolves successfully. No random failure
 * — error-path testing is exercised via the parent's
 * Promise.allSettled aggregation when the C2-shaped wrapper is in
 * place.
 */
export async function apportionExpenditure(
  _expenditureId: Uuid,
  allocations: ReadonlyArray<ValidatedAllocation>,
): Promise<void> {
  // Defensive parity with the future server-side validator. Reject
  // anything the client should never send rather than silently letting
  // the bug propagate to the optimistic-state revert.
  //
  // `ValidatedAllocation` is structurally a subtype of `Allocation`
  // (same fields; activity_id strict-Uuid vs allocation's string with
  // empty-sentinel) so the validation helper accepts it without a cast.
  if (!isValidAllocationSet(allocations)) {
    return Promise.reject(new Error('Invalid apportionment payload'));
  }
  // Tiny simulated latency so the disabled-submit state is visible in
  // dev. Removed the moment the real endpoint is wired — see TODO above.
  await new Promise((resolve) => setTimeout(resolve, 150));
  // TODO(A?-apportion): wire to POST /v1/expenditures/:id/apportion.
  return Promise.resolve();
}
