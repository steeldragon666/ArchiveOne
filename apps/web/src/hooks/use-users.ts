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

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<{ users: UserRef[] }>('/v1/users'),
    select: (d) => d.users,
  });
}
