import type {
  Activity,
  ArtefactKind,
  Event as ApiEvent,
  EvidenceKind,
  UpdateActivityBody,
} from '@cpa/schemas';
import { apiFetch } from '@/lib/api';

// =====================================================================
// Activity create
// =====================================================================

/**
 * POST /v1/activities body. Mirrors {@link CreateActivityBody} in
 * packages/schemas/src/activity.ts. `tenant_id` is derived from the session
 * server-side — clients never send it. `code` (CA-NN / SA-NN) is assigned
 * server-side; callers do not supply it.
 */
export interface CreateActivityInput {
  project_id: string;
  claim_id: string;
  kind: 'core' | 'supporting';
  title: string;
  description?: string;
  hypothesis?: string;
  technical_uncertainty?: string;
  expected_outcome?: string;
}

/**
 * POST /v1/activities. Returns the created activity row.
 *
 * Response shape: `{ activity: Activity }` — unwrapped to the inner Activity
 * so callers can write `const created = await createActivity(input)`.
 *
 * Typed errors from apiFetch:
 *   - 403 → ForbiddenError (viewer role)
 *   - 404 → NotFoundError (claim_id or project_id not in firm)
 */
export async function createActivity(input: CreateActivityInput): Promise<Activity> {
  const body = await apiFetch<{ activity: Activity }>('/v1/activities', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.activity;
}

/**
 * Typed fetch helpers for the activity detail surface (T-A5) and the
 * technical-uncertainty register (T-A6).
 *
 * Mirrors the shape used by `apps/web/src/app/subject-tenants/_lib/api.ts`:
 * thin wrappers around `apiFetch` so every call sends the cpa_session
 * cookie and surfaces typed errors (UnauthenticatedError, ConflictError,
 * etc).
 *
 * URL prefix is `/v1/...` because `next.config.ts` rewrites `/v1/:path*`
 * to the Fastify API. The endpoints exercised here are:
 *   - GET / PATCH `/v1/activities/:id`              (A3)
 *   - GET `/v1/activities/:activity_id/artefacts`   (A6 follow-up)
 *   - GET `/v1/events?activity_id=...&kind=...`     (A6 register feed)
 *
 * Lives at `_lib/` (route-local) rather than `apps/web/src/lib/` because
 * the consumers are co-located under `claims/[claim_id]/activities/...`
 * and there's no cross-route reuse expected — this matches the F-stage
 * convention (see admin/apportionment/_lib, subject-tenants/_lib).
 */

export async function getActivity(id: string): Promise<Activity> {
  const body = await apiFetch<{ activity: Activity }>(`/v1/activities/${id}`);
  return body.activity;
}

export async function updateActivity(id: string, patch: UpdateActivityBody): Promise<Activity> {
  const body = await apiFetch<{ activity: Activity }>(`/v1/activities/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return body.activity;
}

/**
 * Currently-linked artefact for an activity. Mirror of
 * `apps/api/src/lib/activity-artefacts.ts#ActivityArtefact` — duplicated
 * in the web layer (rather than imported across the API boundary) so
 * the wire contract is explicit at the web/API seam.
 */
export interface ActivityArtefact {
  artefact_kind: ArtefactKind;
  artefact_id: string;
  link_reason: string | null;
  linked_event_id: string;
  linked_at: string;
}

export async function listActivityArtefacts(activityId: string): Promise<ActivityArtefact[]> {
  const body = await apiFetch<{ artefacts: ActivityArtefact[] }>(
    `/v1/activities/${activityId}/artefacts`,
  );
  return body.artefacts;
}

export interface ListActivityEventsOptions {
  activity_id: string;
  kinds?: EvidenceKind[];
  limit?: number;
}

export interface ListActivityEventsResponse {
  events: ApiEvent[];
  next_cursor: string | null;
}

/**
 * GET /v1/events?activity_id=...&kind=... — register feed for the A6
 * technical-uncertainty register. Server-side filters on
 * `payload->>'activity_id'` and `kind IN (...)` so we only ship the
 * relevant rows over the wire.
 *
 * Per the events route, when `activity_id` is supplied without
 * `subject_tenant_id` the server resolves the activity → claimant under
 * RLS (cross-firm activity ⇒ 404). The register page only knows the
 * activity_id from the URL, so this is the canonical caller.
 */
export async function listActivityEvents(
  opts: ListActivityEventsOptions,
): Promise<ListActivityEventsResponse> {
  const qs = new URLSearchParams();
  qs.set('activity_id', opts.activity_id);
  if (opts.kinds && opts.kinds.length > 0) qs.set('kind', opts.kinds.join(','));
  if (opts.limit) qs.set('limit', String(opts.limit));
  return apiFetch<ListActivityEventsResponse>(`/v1/events?${qs.toString()}`);
}
