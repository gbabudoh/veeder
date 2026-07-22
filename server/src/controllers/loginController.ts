/**
 * Login controller.
 *
 * Design reference: `design.md` → "Components and Interfaces" (Services →
 * Auth_Service), "Error Handling", and the `POST /login` row of
 * "Endpoint Contracts".
 *
 * HTTP responsibilities only — all authentication logic lives in the
 * {@link AuthService}. The controller:
 *
 * 1. Delegates the raw request body to `authService.login`, passing the source
 *    IP (`req.ip`) so a `login-success`/`login-failure` auth event can be
 *    recorded (Req 11.2, 11.3). The service validates, verifies credentials,
 *    and issues the token pair.
 * 2. On success responds `200` with `{ accessToken, refreshToken }` (Req 3.1,
 *    3.4).
 * 3. On any thrown error, forwards it to `next(err)` so the centralized error
 *    handler maps it to the correct status: `ValidationError` → 400 (malformed,
 *    Req 3.6), `AuthenticationError` → 401 (generic bad credentials, Req 3.5),
 *    and `InternalError`/unhandled → 500 (token persist failure, Req 3.7). Rate
 *    limiting (429, Req 8.2) is enforced by middleware ahead of this controller
 *    and never reaches it.
 *
 * A dependency-injecting factory ({@link createLoginController}) lets tests
 * supply a mock service; the default export {@link loginController} resolves the
 * real {@link getAuthService} lazily on first request so importing this module
 * never triggers configuration loading (mirroring the service's lazy wiring).
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getAuthService, type AuthService } from '../services/authService';

/**
 * Create a login controller bound to the given (optional) service.
 *
 * When `service` is omitted the controller resolves the real Auth_Service
 * lazily via {@link getAuthService} on each request, so constructing the
 * controller (and importing this module) never triggers configuration loading —
 * mirroring the service's own lazy token-manager wiring. Injecting a mock
 * service makes the controller unit-testable without a datastore or signing key.
 *
 * The returned handler is async and wraps its body in try/catch so any rejected
 * promise reaches `next(err)` and is handled by the centralized error handler
 * rather than surfacing as an unhandled rejection.
 */
export function createLoginController(service?: AuthService): RequestHandler {
  return async function loginController(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      // Resolve the real service lazily when none was injected, so importing
      // this module never loads configuration (e.g. the JWT signing key).
      const authService = service ?? getAuthService();
      const result = await authService.login(req.body, { sourceIp: req.ip });
      // 200 with the issued token pair (Req 3.1, 3.4).
      res.status(200).json({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
    } catch (error) {
      // Forward to the centralized error handler, which maps ValidationError →
      // 400 (Req 3.6), AuthenticationError → 401 (Req 3.5), and anything else →
      // 500 (Req 3.7).
      next(error);
    }
  };
}

/**
 * Default login controller wired to the real {@link getAuthService} (resolved
 * lazily per request). Mounted by `src/routes/login.ts`.
 */
export const loginController: RequestHandler = createLoginController();

export default createLoginController;
