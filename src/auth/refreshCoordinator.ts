/**
 * Refresh_Coordinator — single-flight POST /refresh.
 *
 * Guarantees exactly one in-flight refresh at a time. Concurrent callers
 * await the same promise. After settlement the in-flight ref is cleared so
 * a future 401 can start a fresh cycle.
 *
 * Requirements: 4.6 (Property 3: single-flight)
 */

import type { TokenPair } from './types';

export interface RefreshCoordinatorDeps {
  /** Issues the actual POST /refresh network call. Rejects on any failure. */
  performRefresh(): Promise<TokenPair>;
  /** Called when the refresh fails or returns 401 — clears session. */
  onSessionEnded(): void;
}

export interface RefreshCoordinator {
  ensureRefresh(): Promise<TokenPair | null>;
}

export function createRefreshCoordinator(
  deps: RefreshCoordinatorDeps,
): RefreshCoordinator {
  let inFlight: Promise<TokenPair | null> | null = null;

  return {
    ensureRefresh(): Promise<TokenPair | null> {
      // Reuse in-progress refresh (single-flight guarantee).
      if (inFlight !== null) {
        return inFlight;
      }

      const promise = new Promise<TokenPair | null>((resolve) => {
        deps
          .performRefresh()
          .then((pair) => resolve(pair))
          .catch(() => {
            deps.onSessionEnded();
            resolve(null);
          });
      }).finally(() => {
        // Clear so the next 401 triggers a fresh cycle.
        if (inFlight === promise) {
          inFlight = null;
        }
      });

      inFlight = promise;
      return promise;
    },
  };
}

/** Module-level singleton wired by AuthContext at bootstrap. */
let _coordinator: RefreshCoordinator | null = null;

export function setRefreshCoordinator(c: RefreshCoordinator): void {
  _coordinator = c;
}

export function getRefreshCoordinator(): RefreshCoordinator {
  if (!_coordinator) {
    throw new Error('RefreshCoordinator not yet wired. Call setRefreshCoordinator first.');
  }
  return _coordinator;
}
