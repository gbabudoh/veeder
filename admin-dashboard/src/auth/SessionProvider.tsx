/**
 * React session context for the admin dashboard.
 *
 * Wraps the framework-agnostic {@link sessionStore} with React context so
 * components can read `isAuthenticated` and drive `login` / `logout`. The
 * provider subscribes to the store so any change (set or clear, including the
 * interceptor-driven refresh/session-end flows) re-renders consumers.
 *
 * Admin-only gate (Req 10.2, 10.3): a successful `POST /login` only establishes
 * a session when the returned access token carries `role === 'admin'`. When the
 * authenticated account is a non-admin, the freshly issued tokens are DISCARDED
 * (never stored) and the caller is told privileges are required, so a
 * non-privileged user can authenticate but can never obtain a dashboard
 * session.
 *
 * Logout (Req 11.7): best-effort server-side refresh-token invalidation
 * followed by an unconditional local clear.
 *
 * Requirements: 10.2, 10.3, 11.7
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { isAxiosError } from 'axios';
import * as endpoints from '../api/endpoints';
import type { Role } from '../api/types';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  setSession,
  subscribe,
} from './sessionStore';

/**
 * Discriminated outcome of a `login` attempt.
 *
 * - `admin`: authenticated as an administrator; a session was established.
 * - `not-admin`: credentials were valid but the account lacks admin rights;
 *   tokens were discarded and no session exists (Req 10.3).
 * - `invalid`: credentials were rejected by the server (HTTP 401).
 * - `error`: any other failure (network, server error, malformed token).
 */
export type LoginOutcome =
  | { status: 'admin' }
  | { status: 'not-admin' }
  | { status: 'invalid' }
  | { status: 'error' };

/** Value exposed by {@link SessionContext} to consumers. */
export interface SessionContextValue {
  /** True while a session (access token) is currently stored. */
  isAuthenticated: boolean;
  /** Authenticate and, only for admins, establish a session (Req 10.2, 10.3). */
  login(email: string, password: string): Promise<LoginOutcome>;
  /** Invalidate the refresh token server-side (best-effort) and clear locally (Req 11.7). */
  logout(): Promise<void>;
}

/**
 * Safely extract the `role` claim from a JWT access token.
 *
 * Splits on `.`, base64url-decodes the payload (middle) segment, JSON-parses
 * it, and returns the `role` string. Returns `null` on any structural or parse
 * failure so callers never throw on a malformed token. Uses `atob` (browser).
 */
export function decodeRole(accessToken: string): string | null {
  try {
    const segments = accessToken.split('.');
    if (segments.length !== 3) {
      return null;
    }

    // Convert base64url -> base64 and restore padding before decoding.
    const base64url = segments[1];
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '=',
    );

    const json = atob(padded);
    const payload: unknown = JSON.parse(json);

    if (
      typeof payload === 'object' &&
      payload !== null &&
      'role' in payload &&
      typeof (payload as { role: unknown }).role === 'string'
    ) {
      return (payload as { role: string }).role;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The session context. `undefined` sentinel lets {@link useSession} detect and
 * reject usage outside a {@link SessionProvider}.
 */
const SessionContext = createContext<SessionContextValue | undefined>(
  undefined,
);

/** The admin role constant used to gate session establishment (Req 10.2). */
const ADMIN_ROLE: Role = 'admin';

/**
 * Provides the session context. Tracks `isAuthenticated` by subscribing to the
 * session store so consumers re-render whenever tokens are set or cleared.
 */
export function SessionProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    () => getAccessToken() !== null,
  );

  useEffect(() => {
    // Sync immediately in case the store changed between initial render and
    // subscription, then track every subsequent change.
    setIsAuthenticated(getAccessToken() !== null);
    const unsubscribe = subscribe(() => {
      setIsAuthenticated(getAccessToken() !== null);
    });
    return unsubscribe;
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      try {
        const { accessToken, refreshToken } = await endpoints.login(
          email,
          password,
        );

        // Establish a session ONLY for administrators. For any other role the
        // freshly issued tokens are discarded and the store stays cleared
        // (Req 10.2, 10.3).
        if (decodeRole(accessToken) === ADMIN_ROLE) {
          setSession({ accessToken, refreshToken });
          return { status: 'admin' };
        }
        return { status: 'not-admin' };
      } catch (error: unknown) {
        if (isAxiosError(error) && error.response?.status === 401) {
          return { status: 'invalid' };
        }
        return { status: 'error' };
      }
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    // Best-effort server-side invalidation; ignore any failure so the local
    // session is always cleared (Req 11.7).
    try {
      await endpoints.logout(getRefreshToken() ?? '');
    } catch {
      // Intentionally ignored: local clear must proceed regardless.
    }
    clearSession();
  }, []);

  const value: SessionContextValue = { isAuthenticated, login, logout };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

/**
 * Read the session context. Throws when used outside a {@link SessionProvider}
 * so misuse fails loudly during development.
 */
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider.');
  }
  return context;
}
