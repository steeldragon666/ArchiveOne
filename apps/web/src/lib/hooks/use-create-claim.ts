'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

interface CreateClaimResponse {
  id: string;
}

interface CreateClaimInput {
  client_id?: string | null;
}

/**
 * Mutation hook for the consultant dashboard "+ New claim" button.
 *
 * POSTs to /v1/consultant/claims and returns the new claim id. The
 * server picks a placeholder subject_tenant + free fiscal year when
 * `client_id` is null — the wizard's step 1 reassigns the claimant
 * before the draft commits to anything irreversible.
 *
 * On success, invalidates the consultant-claims feed so the dashboard
 * ClaimsPanel re-fetches and shows the new draft.
 */
export function useCreateClaim() {
  const qc = useQueryClient();
  return useMutation<CreateClaimResponse, Error, CreateClaimInput | void>({
    mutationFn: (input) =>
      apiFetch<CreateClaimResponse>('/v1/consultant/claims', {
        method: 'POST',
        body: JSON.stringify({ client_id: input?.client_id ?? null }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['consultant-claims'] });
    },
  });
}
