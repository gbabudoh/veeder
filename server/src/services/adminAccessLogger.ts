/**
 * Admin_Access_Logger service — non-blocking, structured audit logger for
 * admin-authorization outcomes.
 *
 * Design reference: `design.md` → "Admin_Access_Logger (`adminAccessLogger`)"
 * and the `AdminAccessLogger` interface declared in
 * `../middleware/adminGuard`.
 *
 * The `adminGuard` middleware invokes this logger for both outcomes of an
 * admin-authorization decision:
 *
 *  - {@link AdminAccessLogger.recordAllowed} — an admin request was permitted
 *    (Req 9.1).
 *  - {@link AdminAccessLogger.recordDenied} — a request was rejected with 403
 *    (Req 9.2).
 *
 * Each record emits a single structured `pino` log entry through the shared
 * {@link logger} containing exactly four request-derived fields plus the
 * outcome (Req 9.3):
 *
 *  - `userId`   — the verified requester id attached by `authGuard`
 *                 (`req.userId`);
 *  - `endpoint` — the requested path (`req.originalUrl`, falling back to
 *                 `req.path`);
 *  - `method`   — the HTTP method (`req.method`);
 *  - `timestamp`— an ISO-8601 UTC millisecond instant from the injected clock;
 *  - `outcome`  — `'allowed'` or `'denied'`.
 *
 * It NEVER reads or emits secrets: no token, password, or `Authorization`
 * header is ever touched, regardless of the request logger's own redaction
 * (Req 9.3). It does NOT persist to `auth_events`; it emits structured `pino`
 * log entries only.
 *
 * NON-BLOCKING (Req 9.4): every emit is wrapped in try/catch and any error is
 * swallowed, so a logging failure never throws, never alters, and never delays
 * the originating response.
 */

import type { Request } from 'express';
import type { Logger } from 'pino';

import { logger as sharedLogger } from '../middleware/requestLogger';
import type { AdminAccessLogger } from '../middleware/adminGuard';

/** The authorization outcome recorded on an admin-access log entry. */
export type AdminAccessOutcome = 'allowed' | 'denied';

/**
 * The exact, non-sensitive shape of a single admin-access log entry (Req 9.3).
 * Only these five fields are ever emitted — never a token, password, or header.
 */
export interface AdminAccessLogEntry {
  /** Verified requester id attached by `authGuard` (`req.userId`); may be undefined. */
  userId: string | undefined;
  /** Requested endpoint path (`req.originalUrl` or `req.path`). */
  endpoint: string;
  /** HTTP method of the request (`req.method`). */
  method: string;
  /** ISO-8601 UTC millisecond timestamp of the decision. */
  timestamp: string;
  /** Whether the admin authorization allowed or denied the request. */
  outcome: AdminAccessOutcome;
}

/** Dependencies for {@link createAdminAccessLogger}. All are optional and defaulted. */
export interface AdminAccessLoggerDeps {
  /**
   * `pino` logger to emit entries through. Defaults to the shared, redaction
   * aware {@link sharedLogger}. Injectable (e.g. a logger writing to an
   * in-memory stream) for tests.
   */
  logger?: Logger;
  /** Clock source. Defaults to `() => new Date()`. Injectable for tests. */
  now?: () => Date;
}

/**
 * Extract only the four non-sensitive request fields the logger is permitted to
 * emit. No token, password, or header is read here (Req 9.3).
 */
function extractRequestFields(req: Request): Pick<AdminAccessLogEntry, 'userId' | 'endpoint' | 'method'> {
  return {
    userId: req.userId,
    endpoint: req.originalUrl ?? req.path,
    method: req.method,
  };
}

/**
 * Create an Admin_Access_Logger bound to the given (optional) dependencies.
 *
 * With no arguments it emits through the shared {@link sharedLogger} using a
 * wall-clock `now`. Injecting a mock `logger` (and optionally `now`) makes the
 * logger fully unit-testable. The returned object structurally satisfies the
 * {@link AdminAccessLogger} interface consumed by `adminGuard`.
 */
export function createAdminAccessLogger(deps: AdminAccessLoggerDeps = {}): AdminAccessLogger {
  const logger = deps.logger ?? sharedLogger;
  const now = deps.now ?? (() => new Date());

  /**
   * Emit a single structured entry for `outcome`. Wrapped in try/catch so a
   * logging failure is swallowed and never interrupts the caller (Req 9.4).
   */
  function record(req: Request, outcome: AdminAccessOutcome): void {
    try {
      const entry: AdminAccessLogEntry = {
        ...extractRequestFields(req),
        timestamp: now().toISOString(),
        outcome,
      };
      logger.info(entry, 'admin-access');
    } catch {
      // Non-blocking (Req 9.4): audit logging must never throw, alter, or delay
      // the originating response.
    }
  }

  return {
    recordAllowed(req: Request): void {
      record(req, 'allowed');
    },

    recordDenied(req: Request): void {
      record(req, 'denied');
    },
  };
}

/**
 * Default Admin_Access_Logger instance wired to the shared `pino` logger.
 * The router (task 8.2) injects this into the `adminGuard`; tests should prefer
 * {@link createAdminAccessLogger} with an injected logger.
 */
export const adminAccessLogger: AdminAccessLogger = createAdminAccessLogger();

export default createAdminAccessLogger;
