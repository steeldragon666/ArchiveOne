import type { SubjectTenant, SubjectTenantKind } from '@cpa/schemas';
import { apiFetch } from '@/lib/api';

/**
 * Typed fetch helpers for the subject-tenant + event surfaces.
 *
 * These wrap `apiFetch` (the project-wide cookie-aware fetch in
 * `@/lib/api`) so every call sends the cpa_session cookie and surfaces
 * typed errors (UnauthenticatedError, ConflictError, etc).
 *
 * URL prefix is `/v1/...` because `next.config.ts` rewrites `/v1/:path*`
 * to the Fastify API on localhost:3000. Matches the P1 hooks (use-users,
 * use-whoami) — see those for the established pattern.
 */

export async function listSubjectTenants(): Promise<SubjectTenant[]> {
  const body = await apiFetch<{ subject_tenants: SubjectTenant[] }>('/v1/subject-tenants');
  return body.subject_tenants;
}

export interface CreateSubjectTenantInput {
  name: string;
  kind: SubjectTenantKind;
}

export async function createSubjectTenant(
  input: CreateSubjectTenantInput,
): Promise<SubjectTenant> {
  const body = await apiFetch<{ subject_tenant: SubjectTenant }>('/v1/subject-tenants', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.subject_tenant;
}
