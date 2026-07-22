/**
 * AuthContext — React context, provider, and hook for the auth feature.
 *
 * AuthProvider:
 *  - Starts in 'loading' state.
 *  - On mount reads tokenStore; if tokens present → 'authenticated', else → 'unauthenticated'.
 *  - Keeps in-memory session in a ref (for the interceptor hot-path).
 *  - Wires the refreshCoordinator with the real /refresh call + onSessionEnded.
 *
 * Requirements: 2.3, 3.2, 3.3, 3.4, 6.2, 6.3, 8.2, 8.3, 8.4
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import axios from 'axios';
import { BACKEND_URL } from './config';
import { tokenStore } from './tokenStore';
import { authService } from './authService';
import { createRefreshCoordinator, setRefreshCoordinator } from './refreshCoordinator';
import { setSessionRef } from './apiClient';
import type { AuthContextValue, AuthState, LoginResult, TokenPair, UserProfile } from './types';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [user, setUser] = useState<UserProfile | null>(null);

  // In-memory session ref — read by apiClient interceptor on every request.
  const sessionRef = useRef<TokenPair | null>(null);

  // clearSession — nulls memory, clears storage, goes to login.
  const clearSession = useCallback((): void => {
    sessionRef.current = null;
    setUser(null);
    void tokenStore.clear();
    setAuthState('unauthenticated');
  }, []);

  // Bootstrap: inject refs and wire coordinator, then read storage.
  useEffect(() => {
    // Inject session ref into apiClient so interceptors can read the token.
    setSessionRef(sessionRef);

    // Wire the refresh coordinator with a bare axios.post (not apiClient,
    // to avoid interceptor recursion) and the clearSession callback.
    const coordinator = createRefreshCoordinator({
      performRefresh: async () => {
        const refreshToken = sessionRef.current?.refreshToken ?? '';
        const response = await axios.post<TokenPair>(`${BACKEND_URL}/refresh`, {
          refreshToken,
        });
        const newPair = response.data;
        sessionRef.current = newPair;
        await tokenStore.save(newPair);
        return newPair;
      },
      onSessionEnded: clearSession,
    });
    setRefreshCoordinator(coordinator);

    // Read persisted tokens.
    tokenStore.load().then((pair) => {
      if (pair) {
        sessionRef.current = pair;
        setAuthState('authenticated');
      } else {
        setAuthState('unauthenticated');
      }
    });
  }, [clearSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const result = await authService.login(email, password);
      if (result.ok) {
        // authService.login already called tokenStore.save; now update memory.
        const pair = await tokenStore.load();
        if (pair) {
          sessionRef.current = pair;
        }
        setAuthState('authenticated');
      }
      return result;
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = sessionRef.current?.refreshToken ?? '';
    try {
      await authService.logout(refreshToken);
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value: AuthContextValue = { user, authState, login, logout, clearSession };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return ctx;
}
