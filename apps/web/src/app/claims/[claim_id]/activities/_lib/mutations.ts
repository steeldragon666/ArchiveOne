import type { Activity } from '@cpa/schemas';
import { apiFetch } from '@/lib/api';

// =====================================================================
// Activity archive (DELETE /v1/activities/:id)
// =====================================================================

/**
 * DELETE /v1/activities/:id — soft-delete (sets archived_at).
 *
 * Mirrors the project archive pattern (DELETE /v1/projects/:id). Returns the
 * archived activity row.
 *
 * Typed errors from apiFetch:
 *   - 403 → ForbiddenError (viewer role)
 *   - 404 → NotFoundError (activity not in firm)
 */
export async function archiveActivity(id: string): Promise<Activity> {
  const body = await apiFetch<{ activity: Activity }>(`/v1/activities/${id}`, {
    method: 'DELETE',
  });
  return body.activity;
}
