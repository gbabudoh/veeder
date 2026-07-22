/**
 * Configured axios instance for the admin dashboard.
 *
 * This module owns the single HTTP client used by every admin API call and
 * wires the auth flow into axios interceptors:
 *
 * - **HTTPS-only** (Req 16.3, 16.4): the base URL is read from
 *   `VITE_API_BASE_URL` and MUST be `https://`. The request interceptor also
 *   re-validates the fully resolved request URL so a per-request override can
 *   never downgrade to plaintext.
 * - **Bearer token in header only** (Req 11.2, 16.6): the current access token
 *   is attached as `Authorization: Bearer <token>` and never placed in the URL
 *   or query string.
 * - **Refresh-on-401** (Req 11.3, 11.4): a 401 on a non-refresh request triggers
 *   a single-flight refresh via the {@link RefreshCoordinator}. On success the
 *   original request is retried exactly once with the new token; a second 401
 *   (already retried) or a null refresh result (session ended) surfaces the
 *   failure.
 * - **403 → admin required** (Req 11.8): a 403 is rejected with an
 *   `isAdminRequired` marker and is never retried.
 *
 * The refresh network call is made with a BARE `axios.post` (not `client`) so it
 * bypasses these interceptors and cannot recurse.
 *
 * Requirements: 11.2, 11.3, 11.4, 11.8, 16.3, 16.4, 16.6
 */

import axios, {
  AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  setSession,
} from '../auth/sessionStore';
import { createRefreshCoordinator } from './refreshCoordinator';
import type { RefreshTokens } from './refreshCoordinator';

/**
 * Per-request config extended with our internal retry marker. `_retried` is set
 * once a request has already been retried after a refresh so a subsequent 401
 * is surfaced instead of looping.
 */
interface RetryableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

/**
 * The base URL for all admin API calls. Read once at module init from Vite's
 * environment. Must be an `https://` URL (Req 16.3).
 */
const baseURL: string = import.meta.env.VITE_API_BASE_URL;

if (typeof baseURL !== 'string' || baseURL.length === 0) {
  throw new Error(
    'VITE_API_BASE_URL is not set. The admin dashboard requires an https:// API base URL.',
  );
}

// Allow http://localhost in local dev (import.meta.env.DEV); enforce https:// in production.
const isDev = import.meta.env.DEV;
const isLocalhost =
  baseURL.startsWith('http://localhost') || baseURL.startsWith('http://127.0.0.1');

if (!baseURL.startsWith('https://') && !(isDev && isLocalhost)) {
  throw new Error(
    `VITE_API_BASE_URL must use https:// (got: ${baseURL}). Plaintext transport is not permitted.`,
  );
}

/** The single shared axios instance for the admin dashboard. */
const client = axios.create({ baseURL });

/**
 * Resolve the absolute URL a request will target from its config, so we can
 * validate the scheme before the request leaves the client (Req 16.4). Handles
 * both absolute request URLs and ones relative to `baseURL`.
 */
function resolveRequestUrl(config: InternalAxiosRequestConfig): string {
  const url = config.url ?? '';
  const base = config.baseURL ?? '';
  if (/^https?:\/\//i.test(url)) {
    // An absolute URL on the request overrides the base URL.
    return url;
  }
  return `${base}${url}`;
}

// REQUEST interceptor: enforce https + attach the bearer token (header only).
client.interceptors.request.use((config) => {
  const resolved = resolveRequestUrl(config);
  const resolvedIsLocalhost =
    resolved.startsWith('http://localhost') || resolved.startsWith('http://127.0.0.1');
  if (!resolved.startsWith('https://') && !(isDev && resolvedIsLocalhost)) {
    throw new Error(
      `Refusing to send a non-https request to "${resolved}". All admin API calls must use https://.`,
    );
  }

  const token = getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }

  return config;
});

/**
 * Single-flight refresh coordinator. `performRefresh` uses a BARE `axios.post`
 * (not `client`) so it skips the interceptors above and cannot recurse. Any
 * non-2xx (e.g. 401) or network error rejects, which the coordinator treats as
 * a session-ended signal.
 */
export const refreshCoordinator = createRefreshCoordinator({
  performRefresh: async (): Promise<RefreshTokens> => {
    const response = await axios.post<RefreshTokens>(`${baseURL}/refresh`, {
      refreshToken: getRefreshToken(),
    });
    const { accessToken, refreshToken } = response.data;
    return { accessToken, refreshToken };
  },
  onSession: setSession,
  onSessionEnded: clearSession,
});

// RESPONSE interceptor: refresh-on-401, 403 admin marker, else surface as-is.
client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status;
    const config = error.config as RetryableConfig | undefined;

    // 403 → caller lacks admin privileges. Mark and never retry (Req 11.8).
    if (status === 403) {
      (error as AxiosError & { isAdminRequired?: boolean }).isAdminRequired =
        true;
      return Promise.reject(error);
    }

    if (status === 401 && config) {
      const resolved = resolveRequestUrl(config);
      const isRefreshCall = resolved === `${baseURL}/refresh`;

      // A 401 from the refresh call itself, or an already-retried request, is a
      // terminal failure — surface it without further retry (Req 11.4).
      if (isRefreshCall || config._retried) {
        return Promise.reject(error);
      }

      // First 401 on a normal request: attempt a single-flight refresh and, on
      // success, retry the original request exactly once (Req 11.3).
      config._retried = true;
      const token = await refreshCoordinator.ensureRefresh();
      if (token === null) {
        // Session ended (timeout / 401 / network error during refresh).
        return Promise.reject(error);
      }

      config.headers.set('Authorization', `Bearer ${token}`);
      return client(config);
    }

    // Everything else: reject as-is.
    return Promise.reject(error);
  },
);

export { client };
export default client;
