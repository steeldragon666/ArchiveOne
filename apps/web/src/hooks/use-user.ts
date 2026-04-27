'use client';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface UserRef {
  id: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'consultant' | 'viewer';
  isDefault: boolean;
  addedAt: string;
}

export function useUser(userId: string) {
  return useQuery({
    queryKey: ['users', userId],
    queryFn: () => apiFetch<UserRef>(`/v1/users/${userId}`),
    enabled: Boolean(userId),
  });
}
