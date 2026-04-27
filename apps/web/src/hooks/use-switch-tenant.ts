'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export function useSwitchTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) =>
      apiFetch<unknown>('/v1/tenants/switch', {
        method: 'POST',
        body: JSON.stringify({ tenantId }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });
}
