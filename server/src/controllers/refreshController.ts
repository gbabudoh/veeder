/**
 * Refresh controller — token refresh (rotation) endpoint.
 *
 * Design reference: `design.md` → endpoint contract `POST /refresh` and
 * "Token_Manager (`tokenManager`)". This controller is a thin HTTP mapping over
 * {@link TokenManager.rotateRefreshToken}; all rotation/reuse/revocation logic
 * lives in the token manager (task 8.7).
 *
 * Behavior (Req 4.1–4.6):
 * - Validate the payload first. A missing/empty `refreshToken` is a malformed
 *   request → 400 via {@link ValidationError} (Req 4.5).
 * - On a valid, unexpired, unrevoked token: rotate and respond `200` with the
 *   new access + refresh tokens (Req 4.1, 4.2, 4.3).
 * - On an unknown/expired/revoked token: `401` invalid (Req 4.4).
 * - On reuse of a previously-rotated token: the token manager revokes the whole
 *   family; the API responds with the SAME generic `401` invalid error so reuse
 *   is not disclosed to the caller (Req 4.6).
 *
 * The handler is wrapped so any rejection from the async rotation flow is
 * forwarded to the centralized error handler (task 4.2), which surfaces an
 * unexpected failure as `500` without leaking internals (Req 9.2).
 *
 * The token manager is injected for tests; in production it is resolved lazily
 * from {@link getDefaultTokenManager} on the first request so importing this
 * module never triggers config loading.
 */

import type { RequestHandler } from 'express';

import { TokenError, ValidationError } from '../errors';
import { getDefaultTokenManager, type TokenManager } from '../security/tokenManager';
import { validateRefresh } from '../validation';

/** Options for {@link createRefreshController}. */
export interface RefreshControllerOptions {
  /**
   * Token manager used to rotate the presented refresh token. Defaults to
   * {@link getDefaultTokenManager}, resolved lazily inside the handler so that
   * importing this module never loads configuration. Inject a manager in tests.
   */
  tokenManager?: TokenManager;
}

/**
 * Create the refresh controller.
 *
 * @param options optional dependency overrides (a token manager for tests).
 */
export function createRefreshController(options?: RefreshControllerOptions): RequestHandler {
  // Resolve lazily and memoize: importing this module must not load config, but
  // once serving we avoid rebuilding the default manager on every request.
  let tokenManager = options?.tokenManager;

  return (req, res, next) => {
    // Validate presence of a non-empty refresh token before any store work
    // (Req 4.5). A missing/empty token is a 400 validation error.
    const validation = validateRefresh(req.body);
    if (!validation.ok) {
      next(new ValidationError(validation.fields));
      return;
    }

    const manager = tokenManager ?? (tokenManager = getDefaultTokenManager());

    // Run the async rotation and forward any rejection to the error handler so
    // an unexpected failure becomes a 500 (Req 9.2) rather than an unhandled
    // rejection.
    manager
      .rotateRefreshToken(validation.value.refreshToken)
      .then((result) => {
        switch (result.status) {
          case 'rotated':
            // New access + refresh tokens issued; the presented token is now
            // revoked (Req 4.1, 4.2, 4.3).
            res.status(200).json({
              accessToken: result.accessToken,
              refreshToken: result.refreshToken,
            });
            return;
          case 'invalid':
            // Unknown, expired, or revoked token (Req 4.4).
            next(new TokenError('invalid'));
            return;
          case 'reuse':
            // Reuse detected — the whole family was revoked by the token
            // manager. Return the SAME generic invalid error so reuse is not
            // disclosed to the caller (Req 4.6).
            next(new TokenError('invalid'));
            return;
        }
      })
      .catch(next);
  };
}

/**
 * Default refresh controller bound to the application's default token manager.
 * Suitable for direct use on the refresh route; use
 * {@link createRefreshController} with an injected manager in tests.
 */
export const refreshController: RequestHandler = createRefreshController();

export default createRefreshController;
