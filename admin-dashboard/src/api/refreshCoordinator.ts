/**
 * Single-flight token refresh coordinator for the admin dashboard.
 *
 * The coordinator owns the "refresh the access token" decision so that the
 * axios auth interceptor (wired later in `client.ts`) can simply call
 * `ensureRefresh()` on a 401 and either retry with the returned access token or
 * treat a `null` result as a terminated session.
 *
 * Design goals:
 * - **Single-flight** (Req 11.9): while a refresh is in progress, concurrent
 *   callers await the SAME in-flight promise instead of triggering additional
 *   refresh requests. Once that promise settles, it is cleared so a later 401
 *   can start a fresh refresh.
 * - **Timeout / failure → session ended** (Req 11.5, 11.6): the refresh call is
 *   bounded by a 10-second timeout. A timeout, a rejected refresh call (a 401
 *   from the server or a network error surfaces here as a rejection), all lead
 *   to the session-ended path: `onSessionEnded()` is invoked and the promise
 *   resolves to `null`.
 * - **Success** (Req 11.3): the new tokens are handed to `onSession(...)` and
 *   the promise resolves to the new access token string, which the interceptor
 *   uses to retry the original request at most once.
 *
 * The module keeps its decision logic pure and fully injectable (no direct
 * imports of axios or the session store) so it can be exhaustively property
 * tested for single-flight and timeout behavior without real time or network.
 *
 * Requirements: 11.3, 11.4, 11.9
 */

/** The token pair returned by a successful refresh network call. */
export interface RefreshTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Opaque timer handle. Kept as `unknown` so both the browser's
 * `number`-returning timers and Node's `Timeout`-returning timers (and any test
 * fake) satisfy the injected primitives without coupling to one runtime.
 */
export type TimerHandle = unknown;

/**
 * Injectable dependencies for {@link createRefreshCoordinator}. Every effect the
 * coordinator performs is routed through these so the module stays pure and
 * testable.
 */
export interface RefreshCoordinatorDeps {
  /**
   * Performs the actual refresh network call. Resolves with the new token pair
   * on success. It MUST reject on any failure (including an HTTP 401 or a
   * network error); the coordinator treats every rejection as session-ended.
   */
  performRefresh: () => Promise<RefreshTokens>;
  /** Stores the newly obtained tokens (e.g. into the session store). */
  onSession: (tokens: RefreshTokens) => void;
  /** Clears tokens / routes to login when the session has ended. */
  onSessionEnded: () => void;
  /** Refresh timeout in milliseconds. Defaults to 10000 (10 seconds). */
  timeoutMs?: number;
  /** Injectable `setTimeout`. Defaults to the ambient global timer. */
  setTimeout?: (handler: () => void, ms: number) => TimerHandle;
  /** Injectable `clearTimeout`. Defaults to the ambient global timer. */
  clearTimeout?: (handle: TimerHandle) => void;
}

/** The public surface the axios interceptor depends on. */
export interface RefreshCoordinator {
  /**
   * Ensures a single access-token refresh is in progress and resolves with the
   * new access token, or `null` when the session has ended (timeout / 401 /
   * network error). Concurrent callers share one in-flight refresh.
   */
  ensureRefresh(): Promise<string | null>;
}

/** Default refresh timeout: 10 seconds (Req 11.6). */
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Creates a single-flight refresh coordinator from injectable dependencies.
 */
export function createRefreshCoordinator(
  deps: RefreshCoordinatorDeps,
): RefreshCoordinator {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const setTimer =
    deps.setTimeout ??
    ((handler: () => void, ms: number): TimerHandle =>
      globalThis.setTimeout(handler, ms));
  const clearTimer =
    deps.clearTimeout ??
    ((handle: TimerHandle): void => {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    });

  // The single in-flight refresh, shared by all concurrent callers. `null` when
  // no refresh is currently running.
  let inFlight: Promise<string | null> | null = null;

  /**
   * Runs exactly one refresh attempt bounded by `timeoutMs`. Never rejects: it
   * resolves with the new access token on success, or `null` on timeout /
   * failure (after invoking the appropriate side-effect callback exactly once).
   */
  function runRefresh(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      // Guard so the timeout and the settled network call cannot both fire the
      // resolution or double-invoke a callback.
      let settled = false;

      const endSession = (): void => {
        if (settled) return;
        settled = true;
        deps.onSessionEnded();
        resolve(null);
      };

      const succeed = (tokens: RefreshTokens): void => {
        if (settled) return;
        settled = true;
        deps.onSession(tokens);
        resolve(tokens.accessToken);
      };

      const timer = setTimer(() => {
        // Timeout elapsed before the refresh call settled (Req 11.6).
        endSession();
      }, timeoutMs);

      deps.performRefresh().then(
        (tokens) => {
          clearTimer(timer);
          succeed(tokens);
        },
        () => {
          // A 401 or network error surfaces as a rejection (Req 11.5, 11.6).
          clearTimer(timer);
          endSession();
        },
      );
    });
  }

  return {
    ensureRefresh(): Promise<string | null> {
      // Single-flight: reuse the in-progress refresh (Req 11.9).
      if (inFlight) {
        return inFlight;
      }

      const current = runRefresh();
      inFlight = current;

      // Once this refresh settles, clear it so a later 401 starts fresh. The
      // guard protects against clearing a subsequently-started refresh.
      void current.finally(() => {
        if (inFlight === current) {
          inFlight = null;
        }
      });

      return current;
    },
  };
}
