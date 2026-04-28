import type { Activity, Claim } from '@cpa/schemas';
import {
  filterExpenditures,
  STUB_ACTIVITY_IDS,
  STUB_EXPENDITURES,
  type ExpenditureRow,
} from './expenditure-stub';
import type { ExpenditureFilter } from './url-params';
// import { apiFetch } from '@/lib/api'; // TODO(A2/A3): wire when A2 + A3 ship.

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
  // TODO(A2): replace with `apiFetch<Claim>(`/v1/claims/${id}`)`.
  //
  // Returning a fixture-shaped object (rather than null/throw) keeps the
  // page renderable pre-A2 — the user lands on /claims/<id> from the
  // pipeline kanban or table and sees the tab shell against placeholder
  // header data. The tenant_id is the all-zeros sentinel used elsewhere
  // in the workspace (see use-pipeline-claims.ts test fixtures); the
  // subject_tenant_id is intentionally distinct so it doesn't collide.
  return Promise.resolve<Claim>({
    id,
    tenant_id: '00000000-0000-0000-0000-000000000001',
    subject_tenant_id: '00000000-0000-0000-0000-0000000000aa',
    fiscal_year: 2026,
    stage: 'engagement',
    ausindustry_reference: null,
    submitted_at: null,
    submitted_by_user_id: null,
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
  });
}

export async function listActivities(claimId: string): Promise<Activity[]> {
  // TODO(A3): replace with `apiFetch<{ activities: Activity[] }>(`/v1/activities?claim_id=${claimId}`)`
  // and return `body.activities`. Swimlane A owns this endpoint — see
  // the P4 plan task A3. The query key in claim-tabs.tsx is shaped to
  // match the eventual cache shape so swap-in is a one-liner.
  //
  // C5 needs a non-empty list so the expenditure-tab activity picker
  // has options to render. The IDs match the deterministic UUIDs in
  // `expenditure-stub.ts` so re-map flows show real-looking
  // "→ CA-001 ..." labels out of the box. Five entries (3 CA + 2 SA) is
  // enough to make the picker UX feel real without a scrollbar (the
  // Radix Select handles >5 entries with a viewport, but a pre-scroll
  // list is the more useful default).
  const tenant_id = '00000000-0000-0000-0000-000000000001';
  const project_id = '00000000-0000-0000-0000-0000000000a0';
  const created_at = '2026-04-01T00:00:00.000Z';
  const updated_at = '2026-04-01T00:00:00.000Z';
  return Promise.resolve<Activity[]>([
    {
      id: STUB_ACTIVITY_IDS.CA_001,
      tenant_id,
      project_id,
      claim_id: claimId,
      code: 'CA-001',
      kind: 'core',
      title: 'Adaptive scaffolding algorithm',
      description: null,
      hypothesis: null,
      technical_uncertainty: null,
      experimentation_log: null,
      expected_outcome: null,
      actual_outcome: null,
      created_at,
      updated_at,
    },
    {
      id: STUB_ACTIVITY_IDS.CA_002,
      tenant_id,
      project_id,
      claim_id: claimId,
      code: 'CA-002',
      kind: 'core',
      title: 'Sensor calibration trial',
      description: null,
      hypothesis: null,
      technical_uncertainty: null,
      experimentation_log: null,
      expected_outcome: null,
      actual_outcome: null,
      created_at,
      updated_at,
    },
    {
      id: STUB_ACTIVITY_IDS.CA_003,
      tenant_id,
      project_id,
      claim_id: claimId,
      code: 'CA-003',
      kind: 'core',
      title: 'Closed-loop control prototype',
      description: null,
      hypothesis: null,
      technical_uncertainty: null,
      experimentation_log: null,
      expected_outcome: null,
      actual_outcome: null,
      created_at,
      updated_at,
    },
    {
      id: STUB_ACTIVITY_IDS.SA_001,
      tenant_id,
      project_id,
      claim_id: claimId,
      code: 'SA-001',
      kind: 'supporting',
      title: 'Literature review and prior-art search',
      description: null,
      hypothesis: null,
      technical_uncertainty: null,
      experimentation_log: null,
      expected_outcome: null,
      actual_outcome: null,
      created_at,
      updated_at,
    },
    {
      id: STUB_ACTIVITY_IDS.SA_002,
      tenant_id,
      project_id,
      claim_id: claimId,
      code: 'SA-002',
      kind: 'supporting',
      title: 'Test rig fabrication and instrumentation',
      description: null,
      hypothesis: null,
      technical_uncertainty: null,
      experimentation_log: null,
      expected_outcome: null,
      actual_outcome: null,
      created_at,
      updated_at,
    },
  ]);
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
