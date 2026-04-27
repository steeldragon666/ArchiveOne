'use client';
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000, // 1 min — typical B2B admin tool
      retry: (failureCount, error: unknown) => {
        // Don't retry on auth/permission/notfound/conflict — those are
        // logic errors, not transient. Only retry generic 5xx/network.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 3;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Mutations should NOT retry by default — they could re-execute
      // a write. Caller opts in per-mutation if appropriate.
      retry: false,
    },
  },
});
