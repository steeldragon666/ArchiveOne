import type { Activity, Claim } from '@cpa/schemas';
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

export async function listActivities(_claimId: string): Promise<Activity[]> {
  // TODO(A3): replace with `apiFetch<{ activities: Activity[] }>(`/v1/activities?claim_id=${claimId}`)`
  // and return `body.activities`. Swimlane A owns this endpoint —
  // see the P4 plan task A3. The query key in claim-tabs.tsx is shaped
  // to match the eventual cache shape so swap-in is a one-liner.
  return Promise.resolve<Activity[]>([]);
}
