/**
 * Access-token authentication guard middleware.
 *
 * Design reference: `design.md` → "Request authentication on protected endpoints".
 * Requirements 6.1–6.5: a request to a Protected_Endpoint is processed only when
 * it carries an Access_Token whose signature verifies and whose expiry is in the
 * future (Req 6.1). Every other outcome blocks the request — without modifying
 * any User_Account resource — and surfaces a 401 whose reason distinguishes
 * missing (Req 6.2), invalid signature (Req 6.3), expired (Req 6.4), and
 * malformed (Req 6.5) tokens.
 *
 * The guard is purely a reader/verifier: it never mutates a resource on any
 * path. It delegates the actual classification to
 * {@link TokenManager.verifyAccessToken} (task 8.1) and maps each outcome onto
 * the matching {@link TokenError} reason, which the centralized error handler
 * renders as the appropriate 401 body.
 *
 * The token manager is injected for tests; in production it is resolved lazily
 * from {@link getDefaultTokenManager} on the first request so that importing this
 * module never triggers config loading (and thus never throws when, e.g., a
 * signing key is absent in a pure-logic test context).
 */

import type { RequestHandler } from 'express';

import { TokenError } from '../errors';
import type { Role } from '../repositories/usersRepository';
import { getDefaultTokenManager, type TokenManager } from '../security/tokenManager';

/**
 * Express `Request` augmentation so downstream protected controllers (e.g., the
 * `/me` controller, task 15.5) and the `adminGuard` (task 3.3) can read the
 * authenticated user id and verified role in a type-safe way. The guard sets
 * both `req.userId` and `req.userRole` together, only on the `accepted` path
 * (Req 2.3); a failed verification attaches neither (Req 2.4).
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The authenticated User_Account id, populated by the auth guard. */
      userId?: string;
      /**
       * The verified account Role carried by the access token, populated by the
       * auth guard on the `accepted` path alongside {@link Request.userId}
       * (Req 2.3). Absent when verification fails (Req 2.4).
       */
      userRole?: Role;
    }
  }
}

/** The `Bearer ` scheme prefix expected on the `Authorization` header. */
const BEARER_PREFIX = 'Bearer ';

/** Options for {@link createAuthGuard}. */
export interface AuthGuardOptions {
  /**
   * Token manager used to verify the access token. Defaults to
   * {@link getDefaultTokenManager}, resolved lazily inside the handler so that
   * importing this module never loads configuration. Inject a manager in tests.
   */
  tokenManager?: TokenManager;
}

/**
 * Extract the bearer token from an `Authorization` header value.
 *
 * Only the exact `Bearer <token>` form yields a token; an absent header or any
 * other scheme is treated as no token present (which the token manager then
 * classifies as `missing`, Req 6.2).
 */
function extractBearerToken(headerValue: string | undefined): string | undefined {
  if (headerValue === undefined || !headerValue.startsWith(BEARER_PREFIX)) {
    return undefined;
  }
  return headerValue.slice(BEARER_PREFIX.length);
}

/**
 * Create the access-token auth guard middleware.
 *
 * On `accepted`, the authenticated user id is attached to the request and the
 * pipeline continues (Req 6.1). Every other verification outcome is forwarded to
 * the error handler as a {@link TokenError} with the matching reason and never
 * mutates any resource (Req 6.2–6.5).
 *
 * @param options optional dependency overrides (a token manager for tests).
 */
export function createAuthGuard(options?: AuthGuardOptions): RequestHandler {
  // Resolve lazily and memoize: importing this module must not load config, but
  // once serving we avoid rebuilding the default manager on every request.
  let tokenManager = options?.tokenManager;

  return (req, _res, next) => {
    const manager = tokenManager ?? (tokenManager = getDefaultTokenManager());

    const token = extractBearerToken(req.headers.authorization);
    const result = manager.verifyAccessToken(token);

    switch (result.status) {
      case 'accepted':
        // Read-only: attach identity + verified role together and continue; no
        // resource is modified (Req 6.1). The role is surfaced to the
        // authorization middleware for the current request (Req 2.3).
        req.userId = result.userId;
        req.userRole = result.role;
        next();
        return;
      case 'missing':
        next(new TokenError('missing')); // 401, Req 6.2
        return;
      case 'invalid':
        next(new TokenError('invalid')); // 401, Req 6.3
        return;
      case 'expired':
        next(new TokenError('expired')); // 401, Req 6.4
        return;
      case 'malformed':
        next(new TokenError('malformed')); // 401, Req 6.5
        return;
    }
  };
}

/**
 * Default auth guard bound to the application's default token manager. Suitable
 * for direct use on protected routes; use {@link createAuthGuard} with an
 * injected manager in tests.
 */
export const authGuard: RequestHandler = createAuthGuard();

export default createAuthGuard;
