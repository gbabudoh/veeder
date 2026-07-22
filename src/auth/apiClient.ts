/**
 * API_Client — axios instance with auth interceptors.
 *
 * Request interceptor: attaches Bearer token from the in-memory session ref.
 * Response interceptor: on 401 for non-auth endpoints, calls the single-flight
 * refreshCoordinator, then retries the original request once.
 *
 * The session ref is injected by AuthContext after mount to avoid circular imports.
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 7.2
 */

import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { MutableRefObject } from 'react';
import { BACKEND_URL } from './config';
import type { TokenPair } from './types';
import { getRefreshCoordinator } from './refreshCoordinator';

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

/** Auth endpoints — never attempt refresh for these. */
const AUTH_ENDPOINTS = ['/login', '/register', '/refresh'];
function isAuthEndpoint(url: string | undefined): boolean {
  return AUTH_ENDPOINTS.some(e => url?.endsWith(e));
}

// ── Lazy singleton ────────────────────────────────────────────────────────────
let _client: ReturnType<typeof axios.create> | null = null;
let _sessionRef: MutableRefObject<TokenPair | null> | null = null;

export function setSessionRef(ref: MutableRefObject<TokenPair | null>): void {
  _sessionRef = ref;
}

export function getApiClient(): ReturnType<typeof axios.create> {
  if (_client) return _client;

  const client = axios.create({ baseURL: BACKEND_URL });

  // ── Request interceptor: attach Bearer token from in-memory session ─────────
  client.interceptors.request.use((config) => {
    const token = _sessionRef?.current?.accessToken;
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  });

  // ── Response interceptor: 401 → single-flight refresh → retry once ──────────
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const status = error.response?.status;
      const config = error.config as RetryableConfig | undefined;

      if (status === 401 && config && !isAuthEndpoint(config.url) && !config._retried) {
        config._retried = true;

        const newPair = await getRefreshCoordinator().ensureRefresh();

        if (newPair === null) {
          // Session ended — clearSession already called inside coordinator.
          return Promise.reject(error);
        }

        // Update in-memory session with new access token and retry.
        if (_sessionRef) {
          _sessionRef.current = newPair;
        }
        config.headers.set('Authorization', `Bearer ${newPair.accessToken}`);
        return client(config);
      }

      return Promise.reject(error);
    },
  );

  _client = client;
  return _client;
}
