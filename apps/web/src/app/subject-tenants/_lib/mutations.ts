import type { SubjectTenant } from '@cpa/schemas';
import { apiFetch } from '@/lib/api';

// =====================================================================
// Subject-tenant update (PATCH /v1/subject-tenants/:id)
// =====================================================================

export interface UpdateSubjectTenantInput {
  name?: string;
}

/**
 * PATCH /v1/subject-tenants/:id — partial update (currently: name only).
 *
 * Typed errors from apiFetch:
 *   - 400 → Error (Zod validation failure)
 *   - 403 → ForbiddenError (viewer role)
 *   - 404 → NotFoundError (subject_tenant not in firm or soft-deleted)
 *   - 409 → ConflictError (duplicate name)
 */
export async function updateSubjectTenant(
  id: string,
  input: UpdateSubjectTenantInput,
): Promise<SubjectTenant> {
  const body = await apiFetch<{ subject_tenant: SubjectTenant }>(`/v1/subject-tenants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return body.subject_tenant;
}

// =====================================================================
// Subject-tenant archive (DELETE /v1/subject-tenants/:id)
// =====================================================================

/**
 * DELETE /v1/subject-tenants/:id — soft-delete (sets deleted_at).
 *
 * Returns the archived subject_tenant row.
 *
 * Typed errors from apiFetch:
 *   - 403 → ForbiddenError (viewer role)
 *   - 404 → NotFoundError (subject_tenant not in firm)
 */
export async function archiveSubjectTenant(id: string): Promise<SubjectTenant> {
  const body = await apiFetch<{ subject_tenant: SubjectTenant }>(`/v1/subject-tenants/${id}`, {
    method: 'DELETE',
  });
  return body.subject_tenant;
}
