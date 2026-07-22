/** The pair of tokens returned by login and refresh endpoints. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** The authenticated user's profile from GET /me. */
export interface UserProfile {
  id: string;
  email: string;
}

/** The three states driving AuthNavigator rendering. */
export type AuthState = 'loading' | 'authenticated' | 'unauthenticated';

/** Result of a login attempt — never throws. */
export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_credentials' | 'rate_limited' | 'network_error' };

/** Result of a registration attempt — never throws. */
export type RegisterResult =
  | { ok: true }
  | { ok: false; reason: 'already_exists' | 'invalid_input' | 'rate_limited' | 'network_error' };

/** Value exposed by AuthContext to consumers. */
export interface AuthContextValue {
  /** Null while loading or when unauthenticated. */
  user: UserProfile | null;
  /** Current auth state; drives AuthNavigator rendering. */
  authState: AuthState;
  /** Attempt login — never throws, all failures encoded in LoginResult. */
  login(email: string, password: string): Promise<LoginResult>;
  /** Sign out — best-effort server call, always clears session. */
  logout(): Promise<void>;
  /** Clear session immediately (called by interceptor on token expiry). */
  clearSession(): void;
}
