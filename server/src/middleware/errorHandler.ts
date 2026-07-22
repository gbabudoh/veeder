/**
 * Centralized Express error-handling middleware.
 *
 * Design reference: `design.md` → "Error Handling".
 * Requirement 9.1: every error response carries the shared {@link ErrorBody}
 * shape with a machine-readable `code` and a human-readable `message`.
 * Requirement 9.2: stack traces and internal details are never returned to the
 * client; unhandled errors collapse to a generic `500` / `internal_error`.
 *
 * This is the single formatting authority for error responses — controllers and
 * middleware throw typed {@link AppError}s and this handler converts them into
 * the wire format. Keeping conversion in one place guarantees the response-shape
 * invariant (Property 21).
 */

import type { ErrorRequestHandler } from 'express';
import { AppError, InternalError, RateLimitError, toErrorBody } from '../errors';

/**
 * Optional server-side logger. Only used to record the error for operators; its
 * output is never sent to the client. Injected to keep the handler testable and
 * side-effect light (request logging proper is handled by task 14.3).
 */
export interface ErrorLogger {
  error: (error: unknown) => void;
}

/**
 * Create the centralized Express error handler.
 *
 * @param logger optional sink for server-side error logging. When omitted, the
 *   handler performs no logging, keeping it deterministic for property tests.
 */
export function createErrorHandler(logger?: ErrorLogger): ErrorRequestHandler {
  const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
    // If the response has already begun streaming, we cannot rewrite the status
    // or body; defer to Express's default handler to close the connection.
    if (res.headersSent) {
      next(err);
      return;
    }

    if (logger) {
      logger.error(err);
    }

    if (err instanceof AppError) {
      // Surface Retry-After for rate limiting when the wait time is known (Req 8).
      if (err instanceof RateLimitError && err.retryAfterSeconds !== undefined) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
      }
      res.status(err.status).json(toErrorBody(err));
      return;
    }

    // Unknown/unhandled error: never leak internals or stack traces (Req 9.2).
    const internal = new InternalError();
    res.status(internal.status).json(toErrorBody(internal));
  };

  return errorHandler;
}

/**
 * Default error handler with no server-side logging. Suitable for direct use in
 * the middleware pipeline; pass a logger via {@link createErrorHandler} when
 * operator-visible logging is desired.
 */
export const errorHandler: ErrorRequestHandler = createErrorHandler();
