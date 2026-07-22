/**
 * Logout controller.
 *
 * Design reference: `design.md` → "Components and Interfaces" (Services →
 * Auth_Service), "Endpoint Contracts" (the `POST /logout` row: `200 {}` always),
 * and "Degrade-Gracefully Paths" ("Logout never surfaces an error").
 *
 * HTTP responsibilities only — all business logic lives in the
 * {@link AuthService}. The controller:
 *
 * 1. Delegates the raw request body to `authService.logout`, passing the source
 *    IP for auth-event logging (Req 11.4). The service best-effort revokes a
 *    valid, active refresh token and swallows every error internally: it never
 *    throws for valid, already-revoked, absent, or malformed tokens, nor when
 *    the revocation write fails (Req 5.1, 5.2, 5.3, 5.5).
 * 2. Always responds `200 {}` regardless of the token's state (Req 5.2, 5.3).
 * 3. Keeps a defensive try/catch: even though `logout` is documented never to
 *    throw, any unexpected error is still answered with `200` because logout is
 *    best-effort and always `200` (Req 5.2). No error is forwarded to `next`.
 *
 * A dependency-injecting factory ({@link createLogoutController}) lets tests
 * supply a mock service; the default export {@link logoutController} resolves
 * the real {@link AuthService} lazily (via {@link getAuthService}) on each
 * request so importing this module never triggers configuration loading.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getAuthService, type AuthService } from '../services/authService';

/**
 * Create a logout controller bound to the given (optional) service.
 *
 * When no service is provided, the real {@link AuthService} is resolved lazily
 * via {@link getAuthService} on each request. Resolving lazily — rather than at
 * import — avoids loading configuration (e.g. the JWT signing key) merely by
 * importing this module, which keeps it importable in tests. Injecting a mock
 * service makes the controller unit-testable without a datastore.
 *
 * The returned handler always responds `200 {}`. Although `authService.logout`
 * is documented never to throw, the handler still wraps the call in try/catch
 * and answers `200` even on an unexpected error, because logout is best-effort
 * and always `200` (Req 5.2).
 */
export function createLogoutController(service?: AuthService): RequestHandler {
  return async function logoutController(
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> {
    try {
      const authService = service ?? getAuthService();
      // Best-effort revocation; the service swallows all errors internally and
      // never throws (Req 5.1, 5.5). Source IP flows through for the `logout`
      // auth event (Req 11.4).
      await authService.logout(req.body, { sourceIp: req.ip });
    } catch {
      // Defensive only: logout is documented never to throw. Even so, logout is
      // best-effort and must always respond 200 (Req 5.2), so any unexpected
      // error is swallowed here rather than forwarded to the error handler.
    }
    // Always 200, regardless of token state or any internal failure
    // (Req 5.2, 5.3, 5.5).
    res.status(200).json({});
  };
}

/**
 * Default logout controller. Resolves the real {@link AuthService} lazily on
 * each request (see {@link createLogoutController}). Mounted by
 * `src/routes/logout.ts`.
 */
export const logoutController: RequestHandler = createLogoutController();

export default createLogoutController;
