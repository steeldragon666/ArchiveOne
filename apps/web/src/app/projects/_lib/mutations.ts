import type { Project } from '@cpa/schemas';
import { apiFetch } from '@/lib/api';

// =====================================================================
// Project update (PATCH /v1/projects/:id)
// =====================================================================

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  started_at?: string;
  ended_at?: string | null;
}

/**
 * PATCH /v1/projects/:id — partial update. Returns the updated project row.
 *
 * Mirrors UpdateProjectBody in packages/schemas/src/project.ts. All fields
 * are optional; pass null for description/ended_at to clear them.
 *
 * Typed errors from apiFetch:
 *   - 400 → Error (Zod validation failure — invalid date range etc)
 *   - 403 → ForbiddenError (viewer role)
 *   - 404 → NotFoundError (project not in firm or already archived)
 */
export async function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  const body = await apiFetch<{ project: Project }>(`/v1/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return body.project;
}

// =====================================================================
// Project archive (DELETE /v1/projects/:id)
// =====================================================================

/**
 * DELETE /v1/projects/:id — soft-delete (sets archived_at).
 *
 * The optional reason is stored on the PROJECT_ARCHIVED event payload.
 * Returns the archived project row.
 *
 * Typed errors from apiFetch:
 *   - 403 → ForbiddenError (viewer role)
 *   - 404 → NotFoundError (project not in firm)
 *   - 409 → ConflictError (project has active claims that block archive — if enforced)
 */
export async function archiveProject(id: string, reason?: string): Promise<Project> {
  const hasReason = reason && reason.trim().length > 0;
  const body = await apiFetch<{ project: Project }>(`/v1/projects/${id}`, {
    method: 'DELETE',
    ...(hasReason ? { body: JSON.stringify({ reason: reason.trim() }) } : {}),
  });
  return body.project;
}
