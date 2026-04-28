import type { Activity, UpdateActivityBody } from '@cpa/schemas';
import { apiFetch } from '@/lib/api';

/**
 * Typed fetch helpers for the activity detail surface (T-A5).
 *
 * Mirrors the shape used by `apps/web/src/app/subject-tenants/_lib/api.ts`:
 * thin wrappers around `apiFetch` so every call sends the cpa_session
 * cookie and surfaces typed errors (UnauthenticatedError, ConflictError,
 * etc).
 *
 * URL prefix is `/v1/...` because `next.config.ts` rewrites `/v1/:path*`
 * to the Fastify API. The two endpoints below are A3's
 * GET/PATCH `/v1/activities/:id`.
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
