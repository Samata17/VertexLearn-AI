
/**
 * Axios client for the REST API (/api/v1).
 * - Uses the Railway backend URL in production.
 * - Adds Authorization: Bearer <access token> to requests.
 * - Refreshes expired access tokens and retries requests.
 * - Concurrent 401s share one refresh call.
 * - Clears the session only when the refresh token is rejected.
 */

import axios, {
  AxiosError,
  type AxiosRequestConfig,
} from 'axios';

import { getRefreshToken, useAuth } from '@/store/auth';

// Read the backend URL from the Vercel environment variable.
const API_BASE_URL = (import.meta.env.VITE_API_URL || '')
  .replace(/\/+$/, '');

// Use Railway in production; use the local proxy during development
// if VITE_API_URL is not configured.
const API_BASE_PATH = API_BASE_URL
  ? `${API_BASE_URL}/api/v1`
  : '/api/v1';

export const api = axios.create({
  baseURL: API_BASE_PATH,
  timeout: 130_000,
});

// Add access token to every request.
api.interceptors.request.use((config) => {
  const token = useAuth.getState().accessToken;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

/**
 * Result of trying to renew the session.
 */
export type RefreshResult =
  | { status: 'ok'; token: string }
  | { status: 'signed-out' | 'unreachable'; token: null };

let refreshing: Promise<RefreshResult> | null = null;

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function doRefresh(): Promise<RefreshResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const sent = getRefreshToken();

    if (!sent) {
      return { status: 'signed-out', token: null };
    }

    try {
      // Uses the same Railway API base URL.
      const response = await api.post('/auth/refresh', {
        refresh_token: sent,
      }, {
        timeout: 15_000,
      });

      useAuth.getState().setSession(response.data);

      return {
        status: 'ok',
        token: response.data.access_token as string,
      };
    } catch (error) {
      const status = (error as AxiosError).response?.status;

      if (status === 401 || status === 403) {
        // Another tab may have refreshed the session.
        if (getRefreshToken() !== sent) {
          continue;
        }

        useAuth.getState().clear();

        return { status: 'signed-out', token: null };
      }

      if (attempt < 2) {
        await sleep(600 * 2 ** attempt);
      }
    }
  }

  return { status: 'unreachable', token: null };
}

/**
 * Renew the session.
 * Concurrent callers share one refresh request.
 */
export function renewSession(): Promise<RefreshResult> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }

  return refreshing;
}

export async function refreshSession(): Promise<string | null> {
  return (await renewSession()).token;
}

// Handle API responses and expired access tokens.
api.interceptors.response.use(
  (response) => response,

  async (error: AxiosError<any>) => {
    const original = error.config as
      | (AxiosRequestConfig & { _retried?: boolean })
      | undefined;

    if (
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !original.url?.includes('/auth/')
    ) {
      original._retried = true;

      const result = await renewSession();

      if (result.token) {
        original.headers = {
          ...original.headers,
          Authorization: `Bearer ${result.token}`,
        };

        return api(original);
      }

      // Only redirect when the session is actually expired.
      if (
        result.status === 'signed-out' &&
        !location.pathname.startsWith('/login')
      ) {
        location.assign(
          `/login?next=${encodeURIComponent(
            location.pathname + location.search
          )}`
        );
      }
    }

    if (
      error.response?.status === 403 &&
      error.response.data?.error?.code === 'ACCOUNT_SUSPENDED'
    ) {
      useAuth.getState().clear();
      location.assign('/login?suspended=1');
    }

    return Promise.reject(error);
  }
);

/**
 * Human-readable message from an API error.
 */
export function errMsg(
  error: unknown,
  fallback = 'Something went wrong. Please try again.'
) {
  const e = error as AxiosError<any>;

  return (
    e?.response?.data?.error?.message ??
    (e?.code === 'ECONNABORTED'
      ? 'The request timed out.'
      : e?.message) ??
    fallback
  );
}

/**
 * Download a protected file and trigger the browser's save dialog.
 */
export async function downloadFile(
  path: string,
  filename: string
) {
  const response = await api.get(path, {
    responseType: 'blob',
  });

  const url = URL.createObjectURL(response.data);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
