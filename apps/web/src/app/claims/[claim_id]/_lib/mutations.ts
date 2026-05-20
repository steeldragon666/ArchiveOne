import type { Claim } from '@cpa/schemas';
import { apiFetch } from '@/lib/api';

// =====================================================================
// Claim update (PATCH /v1/claims/:id)
// =====================================================================

export interface UpdateClaimInput {
  ausindustry_reference?: string;
  submitted_at?: string;
}

/**
 * PATCH /v1/claims/:id — set ausindustry_reference and/or submitted_at.
 *
 * Server enforces: ausindustry_reference can only be set when stage === 'submitted'.
 * A 409 is returned if that gate fails.
 *
 * Typed errors from apiFetch:
 *   - 400 → Error (Zod validation failure / unknown keys)
 *   - 403 → ForbiddenError (viewer role)
 *   - 404 → NotFoundError (claim not in firm)
 *   - 409 → ConflictError (stage gate: not yet submitted)
 */
export async function updateClaim(id: string, input: UpdateClaimInput): Promise<Claim> {
  const body = await apiFetch<{ claim: Claim }>(`/v1/claims/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return body.claim;
}

// =====================================================================
// Claim stage advance (PATCH /v1/claims/:id/stage)
// =====================================================================

/**
 * PATCH /v1/claims/:id/stage — advance to the next pipeline stage.
 *
 * Stages move forward only (engagement → activity_capture → … → audit_defence).
 * The server validates the transition and returns 400 if the requested stage
 * is not a valid next step from the current one.
 *
 * Typed errors from apiFetch:
 *   - 400 → Error (invalid transition — moving backward or skipping stages)
 *   - 403 → ForbiddenError (viewer role)
 *   - 404 → NotFoundError (claim not in firm)
 */
export async function advanceClaimStage(id: string, toStage: string): Promise<Claim> {
  const body = await apiFetch<{ claim: Claim }>(`/v1/claims/${id}/stage`, {
    method: 'PATCH',
    body: JSON.stringify({ to_stage: toStage }),
  });
  return body.claim;
}
