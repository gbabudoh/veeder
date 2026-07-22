/**
 * Admin authorization guard middleware.
 *
 * Design reference: `design.md` → "Auth guard extension + `adminGuard`".
 * Requirements 3.1, 3.3, 3.4: this guard runs **after** {@link authGuard}, which
 * has already verified the access token and, on success, attached the verified
 * `req.userRole`. A bad/missing/expired/malformed token therefore produced a 401
 * before this guard ever runs (Req 3.2, 3.5), so `adminGuard` only ever
 * distinguishes an `admin` from a non-admin request:
 *
 *  - `req.userRole === 'admin'` → allow the request (call `next()` with no
 *    error). The 1000 ms decision bound (Req 3.1) is met trivially because the
 *    decision is a pure in-memory claim comparison with no I/O.
 *  - any other role (or an absent/normalized `user` role) → forward a
 *    {@link ForbiddenError} (403, code `admin_required`, Req 3.3, 3.4).
 *
 * An optional {@link AdminAccessLogger} is invoked for both outcomes so admin
 * access can be audited (Req 9.1, 9.2). The real implementation is wired later
 * (task 7.1); here the interface is defined and invoked only if provided. The
 * logger is treated as non-blocking: the guard invokes it and continues
 * immediately, and never lets a logging concern alter or delay the
 * authorization outcome.
 */

import type { Request, RequestHandler } from 'express';

import { ForbiddenError } from '../errors';

/**
 * Sink for admin-access audit records. Both methods are best-effort and
 * non-blocking: implementations MUST NOT throw and MUST NOT delay the
 * originating request or rejection (Req 9.4). The concrete implementation is
 * provided by task 7.1 and injected via {@link createAdminGuard}.
 */
export interface AdminAccessLogger {
  /** Record that an admin request was allowed (Req 9.1). */
  recordAllowed(req: Request): void;
  /** Record that a request was denied with 403 (Req 9.2). */
  recordDenied(req: Request): void;
}

/** Dependencies for {@link createAdminGuard}. */
export interface AdminGuardDeps {
  /**
   * Optional audit sink invoked on both the allow and deny paths. When omitted,
   * the guard performs the authorization decision without any auditing.
   */
  accessLogger?: AdminAccessLogger;
}

/**
 * Create the admin authorization guard middleware.
 *
 * Allows the request (calls `next()` with no error) if and only if the verified
 * role attached by {@link authGuard} is exactly `admin`; otherwise it forwards a
 * {@link ForbiddenError} (403). The access logger, when supplied, is invoked
 * first on the allow path (Req 9.1) and before forwarding the error on the deny
 * path (Req 9.2), always in a non-blocking manner.
 *
 * @param deps optional dependencies (an admin access logger for auditing).
 */
export function createAdminGuard(deps?: AdminGuardDeps): RequestHandler {
  const accessLogger = deps?.accessLogger;

  return (req, _res, next) => {
    // authGuard already ran: a rejected token produced a 401 before we get here
    // (Req 3.2, 3.5). This is a pure in-memory claim comparison — no I/O — so it
    // resolves well under the 1000 ms bound (Req 3.1).
    if (req.userRole === 'admin') {
      accessLogger?.recordAllowed(req); // Req 9.1 (non-blocking)
      next();
      return;
    }

    accessLogger?.recordDenied(req); // Req 9.2 (non-blocking)
    next(new ForbiddenError()); // 403, admin privileges required (Req 3.3, 3.4)
  };
}

export default createAdminGuard;
