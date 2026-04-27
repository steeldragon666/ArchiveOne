import { create } from 'zustand';
import type { Employee, BrandConfig } from '../api-client/types.js';

export type Session = {
  access_token: string;
  refresh_token: string;
  /** ms epoch — when the access_token expires (server gives 1h windows). */
  access_token_expires_at: number;
  employee: Employee;
  brand_config: BrandConfig;
};

type SessionState = {
  session: Session | null;
  setSession: (s: Session | null) => void;
  clearSession: () => void;
};

/**
 * In-memory session store. Persistence to expo-secure-store (refresh
 * token only, never the access token) is wired in F13 — this store
 * stays the source of truth for runtime; the secure-store wrapper is
 * the source of truth across launches.
 */
export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  setSession: (s) => set({ session: s }),
  clearSession: () => set({ session: null }),
}));
