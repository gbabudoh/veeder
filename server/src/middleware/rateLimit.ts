/**
 * Per-route rate limiting middleware.
 *
 * Design reference: `design.md` → "Middleware Pipeline (ordering matters)",
 * "Trusting the Source IP", and the `express-rate-limit` technology decision.
 * Requirement 8:
 *   - 8.1 login: at most 10 requests per source IP per rolling 60s window.
 *   - 8.2 login over the limit → `429`, integer `Retry-After` (1..60), attempt
 *         is not processed.
 *   - 8.3 registration: at most 5 requests per source IP per rolling 60s window.
 *   - 8.4 registration over the limit → `429`, integer `Retry-After` (1..60),
 *         attempt is not processed.
 *
 * The limiter short-circuits before the route handler runs, so an over-limit
 * request never reaches the authentication/registration logic (Req 8.2, 8.4).
 * Requests are keyed by source IP using `express-rate-limit`'s default
 * key generator (`req.ip`), which reflects the real client IP because the app
 * configures `trust proxy` scoped to the known proxy hop count (task 16.1).
 *
 * On limit exceeded a custom handler emits the shared {@link ErrorBody} shape
 * with the `rate_limited` code (via {@link RateLimitError}) and sets an integer
 * `Retry-After` header derived from the window length, clamped to `[1, 60]`.
 */

import rateLimit from 'express-rate-limit';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { RateLimitError, toErrorBody } from '../errors';

/** Rolling window length, in milliseconds, for both auth limits (60s; Req 8.1, 8.3). */
const DEFAULT_WINDOW_MS = 60_000;

/** Login limit: at most 10 requests per source IP per window (Req 8.1). */
const DEFAULT_LOGIN_MAX = 10;

/** Registration limit: at most 5 requests per source IP per window (Req 8.3). */
const DEFAULT_REGISTRATION_MAX = 5;

/** Lower bound for the integer `Retry-After` value (Req 8.2, 8.4). */
const MIN_RETRY_AFTER_SECONDS = 1;

/** Upper bound for the integer `Retry-After` value (Req 8.2, 8.4). */
const MAX_RETRY_AFTER_SECONDS = 60;

/**
 * Resolved parameters for a single rate limiter: `max` requests per `windowMs`
 * milliseconds.
 */
export interface RateLimiterParams {
  /** Maximum requests permitted per source IP within the window. */
  max: number;
  /** Rolling window length in milliseconds. */
  windowMs: number;
}

/**
 * Optional overrides accepted by the per-endpoint factories. Both fields
 * default to the specification's fixed contract values when omitted; tests may
 * override them to exercise boundaries without waiting on real 60s windows.
 */
export interface RateLimiterOptions {
  /** Override the maximum requests per window. */
  max?: number;
  /** Override the rolling window length in milliseconds. */
  windowMs?: number;
}

/**
 * Compute the integer `Retry-After`, in seconds, for a given window length.
 *
 * The value is the window rounded up to whole seconds, then clamped to the
 * `[1, 60]` range mandated by Req 8.2 / 8.4 so the header is always a valid
 * integer within contract bounds regardless of the configured window.
 */
function retryAfterSecondsFor(windowMs: number): number {
  const seconds = Math.ceil(windowMs / 1000);
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(MIN_RETRY_AFTER_SECONDS, seconds));
}

/**
 * Create a rate limiter middleware keyed by source IP.
 *
 * Uses `express-rate-limit`'s default key generator (`req.ip`) so limiting is
 * per source IP (Req 8.1, 8.3). On limit exceeded, the custom handler sets an
 * integer `Retry-After` header in `[1, 60]` and responds `429` with the shared
 * {@link ErrorBody} shape, without invoking the downstream handler (Req 8.2,
 * 8.4). Standard `RateLimit-*` headers are enabled; legacy `X-RateLimit-*`
 * headers are disabled.
 *
 * @param params.max maximum requests per source IP within the window.
 * @param params.windowMs rolling window length in milliseconds.
 */
export function createRateLimiter(params: RateLimiterParams): RateLimitRequestHandler {
  const { max, windowMs } = params;
  const retryAfterSeconds = retryAfterSecondsFor(windowMs);

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Custom handler: produce the shared ErrorBody shape and an integer
    // Retry-After in [1, 60]. Because this runs instead of the route handler,
    // the over-limit attempt is never processed (Req 8.2, 8.4).
    handler: (_req, res) => {
      const error = new RateLimitError('Too many requests', retryAfterSeconds);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(error.status).json(toErrorBody(error));
    },
  });
}

/**
 * Create the login rate limiter (default 10 requests / 60s; Req 8.1, 8.2).
 *
 * @param options optional `max` / `windowMs` overrides for tests.
 */
export function createLoginRateLimiter(
  options: RateLimiterOptions = {},
): RateLimitRequestHandler {
  return createRateLimiter({
    max: options.max ?? DEFAULT_LOGIN_MAX,
    windowMs: options.windowMs ?? DEFAULT_WINDOW_MS,
  });
}

/**
 * Create the registration rate limiter (default 5 requests / 60s; Req 8.3, 8.4).
 *
 * @param options optional `max` / `windowMs` overrides for tests.
 */
export function createRegistrationRateLimiter(
  options: RateLimiterOptions = {},
): RateLimitRequestHandler {
  return createRateLimiter({
    max: options.max ?? DEFAULT_REGISTRATION_MAX,
    windowMs: options.windowMs ?? DEFAULT_WINDOW_MS,
  });
}

/**
 * Configured login rate limiter for the login route (task 15.2).
 * Login endpoint: 10 requests per source IP per 60s window (Req 8.1, 8.2).
 */
export const loginRateLimiter: RequestHandler = createLoginRateLimiter();

/**
 * Configured registration rate limiter for the register route (task 15.1).
 * Registration endpoint: 5 requests per source IP per 60s window (Req 8.3, 8.4).
 */
export const registrationRateLimiter: RequestHandler = createRegistrationRateLimiter();

export default createRateLimiter;
