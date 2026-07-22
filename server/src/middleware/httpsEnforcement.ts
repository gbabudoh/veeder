/**
 * HTTPS enforcement middleware.
 *
 * Design reference: `design.md` → "Middleware Pipeline (ordering matters)" and
 * "Environment Model".
 * Requirement 10.4: WHERE the Backend_Service is deployed to a non-local
 * environment, WHEN it receives an inbound request that is not over HTTPS, THE
 * Backend_Service SHALL reject the request without processing it and return a
 * response indicating that HTTPS is required.
 *
 * This middleware runs first in the pipeline so non-HTTPS requests in non-local
 * environments are rejected before any body parsing, logging, or handler work
 * occurs. In local/test environments (where `httpsRequired` is false) it always
 * passes the request through.
 *
 * The factory {@link createHttpsEnforcement} takes the `httpsRequired` flag
 * explicitly so tests can toggle enforcement without constructing a full
 * environment. A convenience {@link httpsEnforcement} built lazily from
 * {@link loadConfig} is also exported for direct use in the pipeline.
 */

import type { Request, RequestHandler } from 'express';
import type { ErrorBody } from '../errors';
import { loadConfig } from '../config';

/** Options controlling HTTPS enforcement behavior. */
export interface HttpsEnforcementOptions {
  /**
   * Whether inbound HTTPS is required. Derived from the environment
   * (`AppConfig.httpsRequired`): false for local/test, true otherwise (Req 10.4).
   */
  httpsRequired: boolean;
}

/** HTTP status returned when an insecure request is rejected (Req 10.4). */
const HTTPS_REQUIRED_STATUS = 403;

/** Stable, machine-readable code for the HTTPS-required rejection. */
const HTTPS_REQUIRED_CODE = 'https_required';

/** Human-readable message for the HTTPS-required rejection. */
const HTTPS_REQUIRED_MESSAGE = 'HTTPS is required';

/**
 * Determine whether an inbound request arrived over a secure transport.
 *
 * The service runs behind a TLS-terminating proxy in deployed environments, so
 * a secure connection is recognized either by Express's own `req.secure`
 * (populated when `trust proxy` is configured) or by an explicit
 * `x-forwarded-proto: https` header set by the proxy.
 */
function isSecureRequest(req: Request): boolean {
  if (req.secure) {
    return true;
  }
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string') {
    return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https';
  }
  return false;
}

/**
 * Create the HTTPS enforcement middleware.
 *
 * When `httpsRequired` is false (local/test), the middleware always calls
 * `next()`. When true, it lets secure requests proceed and rejects insecure
 * ones with `403` and the shared {@link ErrorBody} shape (Req 10.4).
 *
 * @param options.httpsRequired whether to enforce HTTPS for inbound requests.
 */
export function createHttpsEnforcement(options: HttpsEnforcementOptions): RequestHandler {
  const { httpsRequired } = options;

  return (req, res, next) => {
    if (!httpsRequired || isSecureRequest(req)) {
      next();
      return;
    }

    // Reject without processing. Responding directly (rather than delegating to
    // the centralized error handler) keeps the error taxonomy unchanged while
    // still emitting the shared ErrorBody shape (Req 9.1, 10.4).
    const body: ErrorBody = {
      error: {
        code: HTTPS_REQUIRED_CODE,
        message: HTTPS_REQUIRED_MESSAGE,
      },
    };
    res.status(HTTPS_REQUIRED_STATUS).json(body);
  };
}

/**
 * Default HTTPS enforcement middleware built from {@link loadConfig}.
 *
 * The config is read lazily on first request so importing this module does not
 * trigger environment validation at import time (which would interfere with the
 * bootstrap's startup ordering). Prefer {@link createHttpsEnforcement} in tests.
 */
export const httpsEnforcement: RequestHandler = (req, res, next) => {
  const { httpsRequired } = loadConfig();
  return createHttpsEnforcement({ httpsRequired })(req, res, next);
};

export default createHttpsEnforcement;
