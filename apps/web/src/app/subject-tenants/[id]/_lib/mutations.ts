import type { Employee } from '@cpa/schemas';
import { apiFetch } from '@/lib/api';

// =====================================================================
// Employee update (PATCH /v1/employees/:id)
// =====================================================================

export interface UpdateEmployeeInput {
  name?: string;
  job_title?: string | null;
}

/**
 * PATCH /v1/employees/:id — partial update.
 *
 * Updates mutable fields (name, job_title). Email is immutable post-invite
 * (changing it would invalidate the magic-link flow).
 *
 * Typed errors from apiFetch:
 *   - 400 → Error (Zod validation failure)
 *   - 403 → ForbiddenError (viewer role)
 *   - 404 → NotFoundError (employee not in firm or deactivated)
 */
export async function updateEmployee(id: string, input: UpdateEmployeeInput): Promise<Employee> {
  const body = await apiFetch<{ employee: Employee }>(`/v1/employees/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return body.employee;
}

// =====================================================================
// Employee deactivate (DELETE /v1/employees/:id)
// =====================================================================

/**
 * DELETE /v1/employees/:id — soft-deactivation (sets deactivated_at).
 *
 * Deactivated employees no longer appear in the active employee list and
 * cannot receive new magic-link invites. Historical time entries and
 * activity logs are preserved for audit purposes.
 *
 * Typed errors from apiFetch:
 *   - 403 → ForbiddenError (viewer role)
 *   - 404 → NotFoundError (employee not in firm)
 */
export async function deactivateEmployee(id: string): Promise<Employee> {
  const body = await apiFetch<{ employee: Employee }>(`/v1/employees/${id}`, {
    method: 'DELETE',
  });
  return body.employee;
}

// =====================================================================
// Employee list (GET /v1/employees)
// =====================================================================

/**
 * GET /v1/employees[?subject_tenant_id=...] — list employees for a claimant.
 */
export async function listEmployees(subjectTenantId?: string): Promise<Employee[]> {
  const qs = subjectTenantId ? `?subject_tenant_id=${encodeURIComponent(subjectTenantId)}` : '';
  const data = await apiFetch<{ employees: Employee[] }>(`/v1/employees${qs}`);
  return data.employees;
}
