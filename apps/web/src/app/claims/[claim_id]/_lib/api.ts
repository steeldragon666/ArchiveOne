import type { Activity, Claim, Uuid } from '@cpa/schemas';
import { type ExpenditureKind, type ExpenditureRow } from './expenditure-stub';
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

// ─── A-endpoints wire shapes ────────────────────────────────────────────────
// Mirror of the server's GET /v1/claims/:id/expenditures response. Kept inline
// rather than imported from @cpa/agents/@cpa/db (web package boundary — see
// CLAUDE.md "package boundary"); the structural shape matches the route in
// `apps/api/src/routes/expenditures.ts` and the projection in
// `apps/api/src/lib/expenditure-projection.ts`.

interface ApiSingleMapping {
  kind: 'single';
  activity_id: string;
  activity_code: string;
  activity_title: string;
}

interface ApiApportionedMapping {
  kind: 'apportioned';
  allocations: Array<{
    activity_id: string;
    activity_code: string;
    activity_title: string;
    percentage: number;
  }>;
}

type ApiCurrentMapping = ApiSingleMapping | ApiApportionedMapping | null;

interface ApiExpenditure {
  id: string;
  vendor_name: string;
  reference: string | null;
  expenditure_date: string;
  total_amount: string;
  currency: string;
  source: string;
  voided_at: string | null;
  current_mapping: ApiCurrentMapping;
}

const SOURCE_TO_KIND: Readonly<Record<string, ExpenditureKind | undefined>> = {
  xero_invoice: 'INVOICE',
  xero_bank_tx: 'BANK_TX',
  xero_receipt: 'RECEIPT',
};

// Adapter — wire format → ExpenditureRow. Manual / voided rows are filtered
// out (the C5 surface is "what came in from Xero?" and the UI today has no
// affordance for voided rows; the API still 409s mutations on them).
function toExpenditureRow(api: ApiExpenditure): ExpenditureRow | null {
  if (api.voided_at !== null) return null;
  const kind = SOURCE_TO_KIND[api.source];
  if (!kind) return null;

  const row: ExpenditureRow = {
    id: api.id,
    kind,
    date: api.expenditure_date,
    payee: api.vendor_name,
    amount: api.total_amount,
    currency: api.currency,
    reference: api.reference,
  };

  // Split the API's discriminated union into the row's two-field shape
  // (current_mapping for 'single', current_apportionment for 'apportioned').
  // mapped_at / apportioned_at aren't part of the GET payload — they're only
  // used by the optimistic update path on the client. Empty string is fine
  // because no UI surface renders these timestamps for server-loaded rows.
  if (api.current_mapping !== null) {
    if (api.current_mapping.kind === 'single') {
      row.current_mapping = {
        activity_id: api.current_mapping.activity_id,
        activity_code: api.current_mapping.activity_code,
        activity_title: api.current_mapping.activity_title,
        mapped_at: '',
      };
    } else {
      row.current_apportionment = {
        allocations: api.current_mapping.allocations,
        apportioned_at: '',
      };
    }
  }
  return row;
}

/**
 * GET /v1/claims/:id/expenditures?filter=all|unmapped|mapped
 *
 * Real endpoint, RLS-scoped. The server walks the event chain and projects
 * `current_mapping` per row (latest of EXPENDITURE_MAPPED / APPORTIONED /
 * UNMAPPED). Manual-source and voided rows are filtered out client-side —
 * the C5 surface only handles Xero-sourced, active expenditures.
 */
export async function listExpenditures(
  claimId: string,
  filter: ExpenditureFilter,
): Promise<ExpenditureRow[]> {
  const body = await apiFetch<{ expenditures: ApiExpenditure[] }>(
    `/v1/claims/${claimId}/expenditures?filter=${filter}`,
  );
  return body.expenditures.flatMap((e) => {
    const row = toExpenditureRow(e);
    return row ? [row] : [];
  });
}

/**
 * POST /v1/expenditures/:id/map
 *
 * Emits an EXPENDITURE_MAPPED event. Idempotent — re-mapping to the same
 * activity returns the existing chain row without appending a duplicate.
 *
 * Typed errors from apiFetch:
 *   - 401 → UnauthenticatedError
 *   - 404 → NotFoundError (expenditure_not_found / activity_not_in_claim)
 *   - 409 → ConflictError (expenditure_voided)
 */
export async function mapExpenditure(expenditureId: string, activityId: Uuid): Promise<void> {
  await apiFetch<{ event: unknown }>(`/v1/expenditures/${expenditureId}/map`, {
    method: 'POST',
    body: JSON.stringify({ activity_id: activityId }),
  });
}

/**
 * POST /v1/expenditures/:id/apportion
 *
 * Emits an EXPENDITURE_APPORTIONED event. Server validates: sum ≈ 100
 * (±0.001), each pct > 0, length ∈ [1, 5], no duplicate activity ids, every
 * activity in the same claim. Validation parity with `isValidAllocationSet`
 * — the client guards against the same shapes before the network call so a
 * bug here can't propagate to a confused revert.
 *
 * Typed errors:
 *   - 400 → Error (invalid_allocation)
 *   - 404 → NotFoundError (expenditure_not_found / activity_not_in_claim)
 *   - 409 → ConflictError (expenditure_voided)
 */
export async function apportionExpenditure(
  expenditureId: Uuid,
  allocations: ReadonlyArray<ValidatedAllocation>,
): Promise<void> {
  if (!isValidAllocationSet(allocations)) {
    return Promise.reject(new Error('Invalid apportionment payload'));
  }
  await apiFetch<{ event: unknown }>(`/v1/expenditures/${expenditureId}/apportion`, {
    method: 'POST',
    body: JSON.stringify({
      allocations: allocations.map((a) => ({
        activity_id: a.activity_id,
        percentage: a.percentage,
      })),
    }),
  });
}

/**
 * POST /v1/expenditures/:id/unmap
 *
 * Emits an EXPENDITURE_UNMAPPED event clearing the current mapping. Not yet
 * surfaced in the C5 UI; exported for future re-introduction of an explicit
 * "unmap" affordance and to keep the four A-endpoints all accessible from
 * one module.
 */
export async function unmapExpenditure(expenditureId: string, reason?: string): Promise<void> {
  await apiFetch<{ event: unknown }>(`/v1/expenditures/${expenditureId}/unmap`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}
