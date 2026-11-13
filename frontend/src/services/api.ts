/**
 * Axios client for the REST API (/api/v1).
 * - Adds "Authorization: Bearer <access token>" to every request.
 * - When a request fails with 401 (expired access token), it calls /auth/refresh once,
 *   then retries the original request. Concurrent 401s share one refresh call.
 * - If refreshing fails, the session is cleared and the user is sent to /login.
 */
import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { getRefreshToken, useAuth } from '@/store/auth';

export const api = axios.create({ baseURL: '/api/v1', timeout: 130_000 });

api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Result of trying to renew the session:
 *  - ok:          signed in, `token` is the new access token
 *  - signed-out:  the server rejected the refresh token (expired, revoked, suspended) — session cleared
 *  - unreachable: network error, server restarting, rate limit… — the saved session is KEPT so a retry
 *                 or the next reload can still restore it (previously this signed the user out)
 */
export type RefreshResult = { status: 'ok'; token: string } | { status: 'signed-out' | 'unreachable'; token: null };

let refreshing: Promise<RefreshResult> | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function doRefresh(): Promise<RefreshResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const sent = getRefreshToken();
    if (!sent) return { status: 'signed-out', token: null };
    try {
      const r = await axios.post('/api/v1/auth/refresh', { refresh_token: sent }, { timeout: 15_000 });
      useAuth.getState().setSession(r.data);
      return { status: 'ok', token: r.data.access_token as string };
    } catch (e) {
      const status = (e as AxiosError).response?.status;
      if (status === 401 || status === 403) {
        // Another tab may have renewed the session meanwhile and saved a newer token: use that one.
        if (getRefreshToken() !== sent) continue;
        useAuth.getState().clear();
        return { status: 'signed-out', token: null };
      }
      if (attempt < 2) await sleep(600 * 2 ** attempt); // temporary problem: wait, then retry
    }
  }
  return { status: 'unreachable', token: null };
}

/** Renew the session. Concurrent callers share one request. */
export function renewSession(): Promise<RefreshResult> {
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

export async function refreshSession(): Promise<string | null> {
  return (await renewSession()).token;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<any>) => {
    const original = error.config as AxiosRequestConfig & { _retried?: boolean };
    if (error.response?.status === 401 && original && !original._retried && !original.url?.includes('/auth/')) {
      original._retried = true;
      const result = await renewSession();
      if (result.token) {
        original.headers = { ...original.headers, Authorization: `Bearer ${result.token}` };
        return api(original);
      }
      // Only send the user to the sign-in page when the session is really over, not on a network blip.
      if (result.status === 'signed-out' && !location.pathname.startsWith('/login')) {
        location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      }
    }
    if (error.response?.status === 403 && error.response.data?.error?.code === 'ACCOUNT_SUSPENDED') {
      useAuth.getState().clear();
      location.assign('/login?suspended=1');
    }
    return Promise.reject(error);
  },
);

/** Human-readable message from an API error (PRD 8.8 error format). */
export function errMsg(err: unknown, fallback = 'Something went wrong. Please try again.') {
  const e = err as AxiosError<any>;
  return e?.response?.data?.error?.message ?? (e?.code === 'ECONNABORTED' ? 'The request timed out.' : e?.message) ?? fallback;
}

/** Download a protected file (e.g. certificate PDF) and trigger the browser's save dialog. */
export async function downloadFile(path: string, filename: string) {
  const r = await api.get(path, { responseType: 'blob' });
  const url = URL.createObjectURL(r.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
