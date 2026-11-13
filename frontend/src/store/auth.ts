/**
 * Auth state (Zustand).
 * - access token: kept in memory only (not readable by other tabs/scripts after a reload)
 * - refresh token: kept in localStorage so the user stays signed in across reloads;
 *   on startup we exchange it for a fresh access token.
 */
import { create } from 'zustand';
import type { User } from '@/types';

const REFRESH_KEY = 'vl-refresh';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  ready: boolean; // finished the startup session check
  setSession: (s: { access_token: string; refresh_token: string; user: User }) => void;
  setUser: (u: User) => void;
  clear: () => void;
  setReady: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  ready: false,
  setSession: ({ access_token, refresh_token, user }) => {
    try { localStorage.setItem(REFRESH_KEY, refresh_token); } catch { /* storage blocked */ }
    set({ accessToken: access_token, user });
  },
  setUser: (user) => set({ user }),
  clear: () => {
    try { localStorage.removeItem(REFRESH_KEY); } catch { /* ignore */ }
    set({ accessToken: null, user: null });
  },
  setReady: () => set({ ready: true }),
}));

export const getRefreshToken = () => {
  try { return localStorage.getItem(REFRESH_KEY); } catch { return null; }
};

export const homeFor = (role?: string) => (role === 'admin' ? '/admin' : role === 'instructor' ? '/instructor' : '/app');

/** Where to go after signing in: the ?next= page if it's a safe local path, else the role's home. */
export const afterLogin = (next: string | null, role?: string) =>
  next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : homeFor(role);
