'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Claim } from '@cpa/schemas';
import {
  createClaim,
  listClaimsForClient,
} from '@/app/consultant/_components/claims-api';

/**
 * Lists the claims for one client (subject_tenant). One claim per period —
 * a client has many per FY because they finance each refund. Disabled
 * until a client is selected.
 */
export function useClientClaims(subjectTenantId: string | null | undefined) {
  return useQuery<Claim[]>({
    queryKey: ['client-claims', subjectTenantId],
    enabled: Boolean(subjectTenantId),
    queryFn: () => listClaimsForClient(subjectTenantId as string),
  });
}

/**
 * "Prepare claim" — creates a claim for the client + FY. The claim is born
 * wizard-ready (POST /v1/claims seeds workflow_state transactionally), so
 * no follow-on initialize call is needed. Invalidates the client's claims
 * list so the new row appears immediately.
 *
 * Surfaces ConflictError (409) verbatim to the caller — one claim per
 * claimant per FY is a regulator constraint.
 */
export function usePrepareClaim(subjectTenantId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<Claim, Error, number>({
    mutationFn: (fiscalYear: number) => {
      if (!subjectTenantId) {
        throw new Error('A client must be selected to prepare a claim.');
      }
      return createClaim(subjectTenantId, fiscalYear);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['client-claims', subjectTenantId] });
    },
  });
}
