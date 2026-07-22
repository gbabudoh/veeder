import {
  authEventsRepository,
  type AuthEventInput,
  type AuthEventRecord,
} from '../repositories/authEventsRepository';

/**
 * Audit_Logger service — non-blocking, retrying wrapper over the
 * AuthEvents_Repository.
 *
 * Design reference: `design.md` → "Audit_Logger (`auditLogger`)".
 *
 * The Audit_Logger records security-relevant Auth_Events (registration,
 * login-success, login-failure, logout) to the datastore. It adds three
 * behaviors on top of the thin repository writer:
 *
 * 1. **UTC timestamps** — every event carries an explicit `occurredAt` produced
 *    from the injected clock. A JavaScript `Date` is a UTC epoch instant, so the
 *    persisted `timestamptz` is unambiguously UTC (Req 11.1–11.4).
 * 2. **Source-IP placeholder** — when the source IP for a login-success or
 *    login-failure event cannot be determined, a fixed {@link UNKNOWN_SOURCE_IP}
 *    placeholder is recorded instead (Req 11.5).
 * 3. **Retry + non-blocking failure** — a failed insert is retried up to
 *    `retries` total attempts (default 3); if every attempt fails the logger
 *    does NOT throw. Instead it invokes an injected `onFailure` handler and
 *    resolves, so audit logging never interrupts the originating registration,
 *    login, or logout operation (Req 11.8).
 *
 * Each public method records exactly one Auth_Event, so callers invoke the
 * logger once per applicable trigger and multiple events in a single operation
 * each get their own record (Req 11.7).
 *
 * The method signatures deliberately accept only non-sensitive fields (user id,
 * submitted email, source IP): no password or token value is ever passed to or
 * persisted by this service (Req 11.6).
 */

/**
 * Fixed placeholder recorded in place of a source IP address that cannot be
 * determined for a login-success or login-failure event (Req 11.5). Exported so
 * tests and callers can assert against the exact constant.
 */
export const UNKNOWN_SOURCE_IP = 'unknown' as const;

/** Default number of total insert attempts before giving up (Req 11.8). */
export const DEFAULT_AUDIT_RETRIES = 3;

/**
 * Minimal shape of the AuthEvents_Repository the logger depends on. Declaring
 * the dependency structurally (rather than importing the concrete type) keeps
 * the logger trivially testable with a mock repository.
 */
export interface AuditEventRepo {
  insert(input: AuthEventInput): Promise<AuthEventRecord>;
}

/**
 * Context describing why an audit write ultimately failed, passed to the
 * injected {@link AuditLoggerDeps.onFailure} handler after all retries are
 * exhausted. Contains no secret or token values (Req 11.6).
 */
export interface AuditFailure {
  /** The event type whose persistence failed. */
  eventType: AuthEventInput['eventType'];
  /** Total number of attempts made before giving up. */
  attempts: number;
  /** The last error thrown by the repository. */
  error: unknown;
}

/** Dependencies for {@link createAuditLogger}. All are optional and defaulted. */
export interface AuditLoggerDeps {
  /** Repository to persist events. Defaults to {@link authEventsRepository}. */
  repo?: AuditEventRepo;
  /** Total insert attempts before giving up. Defaults to {@link DEFAULT_AUDIT_RETRIES}. */
  retries?: number;
  /** Clock source. Defaults to `() => new Date()`. Injectable for tests. */
  now?: () => Date;
  /**
   * Handler invoked once when all attempts fail. Defaults to a guarded
   * `console.error`. It must never throw in a way that interrupts the caller;
   * the logger swallows handler errors defensively.
   */
  onFailure?: (failure: AuditFailure) => void;
}

/**
 * The Audit_Logger surface. Every method records exactly one Auth_Event
 * (Req 11.7) and resolves without throwing even when persistence fails after
 * all retries (Req 11.8).
 */
export interface AuditLogger {
  /** Record a `registration` event for a newly created account (Req 11.1). */
  recordRegistration(userId: string): Promise<void>;
  /** Record a `login-success` event; placeholder IP when unknown (Req 11.2, 11.5). */
  recordLoginSuccess(userId: string, sourceIp: string | undefined): Promise<void>;
  /** Record a `login-failure` event for the submitted email (Req 11.3, 11.5). */
  recordLoginFailure(email: string, sourceIp: string | undefined): Promise<void>;
  /** Record a `logout` event when a refresh token is revoked (Req 11.4). */
  recordLogout(userId: string): Promise<void>;
}

/** Default non-blocking failure handler: log without leaking the caller's flow. */
function defaultOnFailure(failure: AuditFailure): void {
  // Best-effort diagnostic only. Never rethrows; audit logging is non-blocking.
  // eslint-disable-next-line no-console
  console.error(
    `Audit_Logger: failed to persist "${failure.eventType}" auth event after ${failure.attempts} attempt(s)`,
    failure.error,
  );
}

/**
 * Normalize a source IP: substitute the fixed placeholder when it is undefined
 * or blank so login events always carry a source-IP value (Req 11.5).
 */
function resolveSourceIp(sourceIp: string | undefined): string {
  if (sourceIp === undefined || sourceIp.trim().length === 0) {
    return UNKNOWN_SOURCE_IP;
  }
  return sourceIp;
}

/**
 * Create an Audit_Logger bound to the given (optional) dependencies.
 *
 * With no arguments it uses the real {@link authEventsRepository}, 3 total
 * attempts, a wall-clock `now`, and a guarded `console.error` failure handler.
 * Injecting a mock `repo` (and optionally `now`/`onFailure`) makes the logger
 * fully unit-testable without a datastore.
 */
export function createAuditLogger(deps: AuditLoggerDeps = {}): AuditLogger {
  const repo = deps.repo ?? authEventsRepository;
  const retries = deps.retries ?? DEFAULT_AUDIT_RETRIES;
  const now = deps.now ?? (() => new Date());
  const onFailure = deps.onFailure ?? defaultOnFailure;

  /**
   * Persist a single event with retry-up-to-`retries` and non-blocking failure.
   * Resolves after a successful insert or after exhausting all attempts; never
   * throws so the originating operation is never interrupted (Req 11.8).
   */
  async function record(input: AuthEventInput): Promise<void> {
    // At least one attempt is always made even if a caller passes retries < 1.
    const maxAttempts = Math.max(1, retries);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await repo.insert(input);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    // All attempts failed: emit a non-blocking indication and resolve.
    try {
      onFailure({ eventType: input.eventType, attempts: maxAttempts, error: lastError });
    } catch {
      // A failing failure-handler must not interrupt the originating operation.
    }
  }

  return {
    recordRegistration(userId: string): Promise<void> {
      return record({ eventType: 'registration', userId, occurredAt: now() });
    },

    recordLoginSuccess(userId: string, sourceIp: string | undefined): Promise<void> {
      return record({
        eventType: 'login-success',
        userId,
        sourceIp: resolveSourceIp(sourceIp),
        occurredAt: now(),
      });
    },

    recordLoginFailure(email: string, sourceIp: string | undefined): Promise<void> {
      return record({
        eventType: 'login-failure',
        email,
        sourceIp: resolveSourceIp(sourceIp),
        occurredAt: now(),
      });
    },

    recordLogout(userId: string): Promise<void> {
      return record({ eventType: 'logout', userId, occurredAt: now() });
    },
  };
}

/**
 * Default Audit_Logger instance wired to the real repository. Services import
 * this for production use; tests should prefer {@link createAuditLogger} with a
 * mock repository.
 */
export const auditLogger = createAuditLogger();

export default createAuditLogger;
