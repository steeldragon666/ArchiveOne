import type { Activity, Claim } from '@cpa/schemas';
import { apiFetch } from '@/lib/api';

// =====================================================================
// Types
// =====================================================================

/**
 * A single currently-linked artefact returned from
 * GET /v1/activities/:activity_id/artefacts.
 * Shape mirrors ActivityArtefact in apps/api/src/lib/activity-artefacts.ts.
 */
export interface ActivityArtefact {
  artefact_kind: 'media' | 'event' | 'expenditure' | 'time_entry';
  artefact_id: string;
  link_reason: string | null;
  linked_event_id: string;
  linked_at: string;
}

/**
 * Response envelope from GET /v1/activities/:activity_id/artefacts.
 */
export interface GetActivityArtefactsResponse {
  artefacts: ActivityArtefact[];
}

/**
 * Shape returned when POST /v1/activities/:activity_id/artefact-links
 * succeeds.
 */
export interface CreateArtefactLinkResult {
  event_id: string;
  activity_id: string;
  artefact_kind: string;
  artefact_id: string;
  link_reason: string | null;
}

/**
 * Shape returned when DELETE /v1/activities/:activity_id/artefact-links/:event_id
 * succeeds (HTTP 200).
 */
export interface UnlinkArtefactResult {
  unlinked_event_id: string;
  prior_event_id: string;
  activity_id: string;
  artefact_kind: string;
  artefact_id: string;
}

/**
 * A claim with its associated activities — used to group activities in
 * the bind dialog.
 */
export interface ClaimWithActivities {
  claim: Claim;
  activities: Activity[];
}

// =====================================================================
// GET /v1/claims?subject_tenant_id=...
// =====================================================================

/**
 * List all claims for a given claimant (subject_tenant_id). Used by the
 * bind dialog to group activities under their parent claims.
 */
export async function listClaimsForSubjectTenant(subjectTenantId: string): Promise<Claim[]> {
  const qs = new URLSearchParams({ subject_tenant_id: subjectTenantId });
  const body = await apiFetch<{ claims: Claim[] }>(`/v1/claims?${qs.toString()}`);
  return body.claims;
}

// =====================================================================
// GET /v1/activities?claim_id=...
// =====================================================================

/**
 * List all activities for a given claim. Used to populate the activity
 * picker inside the bind dialog.
 */
export async function listActivitiesForClaim(claimId: string): Promise<Activity[]> {
  const qs = new URLSearchParams({ claim_id: claimId });
  const body = await apiFetch<{ activities: Activity[] }>(`/v1/activities?${qs.toString()}`);
  return body.activities;
}

// =====================================================================
// GET /v1/activities/:activity_id/artefacts
// =====================================================================

/**
 * Fetch the currently-linked artefacts for a single activity.
 * Materialised from ARTEFACT_LINKED minus ARTEFACT_UNLINKED by the server.
 */
export async function getActivityArtefacts(activityId: string): Promise<ActivityArtefact[]> {
  const body = await apiFetch<GetActivityArtefactsResponse>(
    `/v1/activities/${activityId}/artefacts`,
  );
  return body.artefacts;
}

// =====================================================================
// POST /v1/activities/:activity_id/artefact-links
// =====================================================================

export interface CreateArtefactLinkInput {
  /** The ARTEFACT_LINKED event kind accepted by the API. */
  artefact_kind: 'media' | 'event' | 'expenditure' | 'time_entry';
  /** ID of the artefact being linked (e.g. event.id for chain events). */
  artefact_id: string;
  /** Free-form reason shown in the audit chain. */
  link_reason?: string;
}

/**
 * Link an artefact to an activity.
 *
 * POST /v1/activities/:activity_id/artefact-links
 * Body: { artefact_kind, artefact_id, link_reason? }
 */
export async function createArtefactLink(
  activityId: string,
  input: CreateArtefactLinkInput,
): Promise<CreateArtefactLinkResult> {
  return apiFetch<CreateArtefactLinkResult>(`/v1/activities/${activityId}/artefact-links`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// =====================================================================
// DELETE /v1/activities/:activity_id/artefact-links/:event_id
// =====================================================================

/**
 * Unlink an artefact from an activity. The `linkedEventId` is the id of
 * the ARTEFACT_LINKED chain event (available from ActivityArtefact.linked_event_id).
 *
 * DELETE /v1/activities/:activity_id/artefact-links/:event_id
 * Optional body: { reason? }
 */
export async function deleteArtefactLink(
  activityId: string,
  linkedEventId: string,
  reason?: string,
): Promise<UnlinkArtefactResult> {
  return apiFetch<UnlinkArtefactResult>(
    `/v1/activities/${activityId}/artefact-links/${linkedEventId}`,
    {
      method: 'DELETE',
      ...(reason !== undefined ? { body: JSON.stringify({ reason }) } : {}),
    },
  );
}
