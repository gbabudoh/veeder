/**
 * Admin session store — persisted to sessionStorage.
 *
 * Tokens survive a full page refresh (sessionStorage is kept alive for the
 * browser tab's lifetime) but are automatically discarded when the tab is
 * closed. This is the right trade-off for an internal admin tool: no need to
 * re-login on every F5, yet no long-lived credential persisted to disk.
 *
 * The in-memory `currentSession` variable is the authoritative runtime copy.
 * sessionStorage is written on every set/clear so it is always in sync.
 * On module load, the store rehydrates from sessionStorage so the in-memory
 * state is correct before the first React render.
 *
 * Invariant: exactly one access token and one refresh token at a time.
 */

export interface Session {
  accessToken: string;
  refreshToken: string;
}

export type SessionListener = () => void;

const STORAGE_KEY = 'veeder_admin_session';

/** Read a stored session from sessionStorage, or null if absent/corrupt. */
function readStorage(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' && parsed !== null &&
      'accessToken' in parsed && typeof (parsed as Session).accessToken === 'string' &&
      'refreshToken' in parsed && typeof (parsed as Session).refreshToken === 'string'
    ) {
      return { accessToken: (parsed as Session).accessToken, refreshToken: (parsed as Session).refreshToken };
    }
    return null;
  } catch {
    return null;
  }
}

/** Write the session to sessionStorage, or remove the key when null. */
function writeStorage(session: Session | null): void {
  try {
    if (session === null) {
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // sessionStorage unavailable (e.g. private browsing with storage blocked) — continue in-memory only.
  }
}

// Rehydrate on module load so the session survives a page refresh.
let currentSession: Session | null = readStorage();

const listeners = new Set<SessionListener>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Store a new token pair, persist it, and notify subscribers. */
export function setSession(tokens: Session): void {
  currentSession = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  writeStorage(currentSession);
  notify();
}

/** Clear the session, remove it from storage, and notify subscribers. */
export function clearSession(): void {
  currentSession = null;
  writeStorage(null);
  notify();
}

export function getAccessToken(): string | null {
  return currentSession?.accessToken ?? null;
}

export function getRefreshToken(): string | null {
  return currentSession?.refreshToken ?? null;
}

export function getSession(): Session | null {
  return currentSession === null ? null : { ...currentSession };
}

export function subscribe(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
