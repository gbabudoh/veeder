/**
 * Request logging middleware with secret redaction.
 *
 * Design reference: `design.md` → "Middleware Pipeline" step 2 ("Request
 * logging with redaction") and the technology decision to use `pino` "with a
 * custom redaction serializer".
 *
 * Requirement 10.5: when the service writes request or response data to log
 * output it SHALL exclude `password`, `accessToken`, and `refreshToken` values,
 * substituting a fixed redaction placeholder in their place.
 *
 * The primary, unit-testable surface of this module is the pure {@link redact}
 * function: it deep-clones an arbitrary payload and replaces the VALUES of any
 * property whose name matches a secret key (case-insensitive) with
 * {@link REDACTION_PLACEHOLDER}, recursing through nested objects and arrays and
 * never mutating its input. The exported {@link logger} (a configured `pino`
 * instance) and the {@link requestLogger} middleware (a `pino-http` instance)
 * build on top of it; `pino`'s own `redact` paths are configured as well for
 * defense-in-depth, so a secret is scrubbed even if it reaches the logger
 * through a path the serializer did not touch.
 */

import pino, { type Logger, type LoggerOptions } from 'pino';
import pinoHttp, { type HttpLogger, type Options as PinoHttpOptions } from 'pino-http';

/**
 * The fixed placeholder substituted for any redacted secret value (Req 10.5).
 * Exported so tests and callers can assert against the exact constant.
 */
export const REDACTION_PLACEHOLDER = '[REDACTED]' as const;

/**
 * Property names whose values must never appear in log output. Matching is
 * case-insensitive and covers the three secrets named by Req 10.5
 * (`password`, `accessToken`, `refreshToken`), their common snake_case
 * variants, and the `Authorization` header (which carries the bearer access
 * token). Keys are stored lower-cased; {@link isSecretKey} lower-cases the
 * candidate before comparing.
 */
const SECRET_KEYS: ReadonlySet<string> = new Set([
  'password',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'authorization',
]);

/** True when `key` names a secret whose value must be redacted (case-insensitive). */
function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase());
}

/**
 * Recursive worker for {@link redact}.
 *
 * `seen` maps each already-visited source object/array to its cloned
 * counterpart, which both prevents infinite recursion on cyclic structures and
 * preserves shared references in the output.
 */
function redactInternal(value: unknown, seen: WeakMap<object, unknown>): unknown {
  // Primitives (and null/undefined) are returned as-is: they carry no keys.
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // Preserve Date instances as fresh clones rather than emptying them via
  // Object.entries (a Date has no own enumerable properties).
  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  // Return the existing clone for anything we have already visited (cycles /
  // shared references).
  const existing = seen.get(value as object);
  if (existing !== undefined) {
    return existing;
  }

  if (Array.isArray(value)) {
    const clonedArray: unknown[] = [];
    seen.set(value, clonedArray);
    for (const item of value) {
      clonedArray.push(redactInternal(item, seen));
    }
    return clonedArray;
  }

  const clonedObject: Record<string, unknown> = {};
  seen.set(value as object, clonedObject);
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    clonedObject[key] = isSecretKey(key)
      ? REDACTION_PLACEHOLDER
      : redactInternal(nested, seen);
  }
  return clonedObject;
}

/**
 * Deep-clone `payload`, replacing the value of every property named
 * `password`, `accessToken`/`access_token`, `refreshToken`/`refresh_token`, or
 * `authorization` (case-insensitive) with {@link REDACTION_PLACEHOLDER}.
 *
 * Recurses through nested plain objects and arrays. The input is never mutated:
 * primitives are returned unchanged and objects/arrays are returned as new
 * structures. Cyclic and shared references are handled and preserved.
 *
 * This is the primary redaction surface for Req 10.5 and the unit under test
 * for Property 25.
 */
export function redact(payload: unknown): unknown {
  return redactInternal(payload, new WeakMap<object, unknown>());
}

/**
 * `pino` redaction paths applied directly on the logger for defense-in-depth.
 * The pure {@link redact} function is the primary scrubber; these paths ensure
 * secrets are still censored if they reach the logger via a field the
 * serializers did not walk. Single-level wildcards (`*.`) cover the common
 * "secret nested one level under an arbitrary key" shape.
 */
const PINO_REDACT_PATHS: string[] = [
  'password',
  '*.password',
  'accessToken',
  '*.accessToken',
  'access_token',
  '*.access_token',
  'refreshToken',
  '*.refreshToken',
  'refresh_token',
  '*.refresh_token',
  'authorization',
  '*.authorization',
  'req.headers.authorization',
  'res.headers.authorization',
  'req.body.password',
  'req.body.accessToken',
  'req.body.refreshToken',
];

/** Options for {@link createRequestLogger}. */
export interface RequestLoggerOptions {
  /**
   * An existing `pino` logger to log through. Defaults to the module-level
   * {@link logger}. Injecting a logger (e.g. one writing to an in-memory
   * stream) makes the middleware testable.
   */
  logger?: Logger;
}

/** Base `pino` options shared by the default logger, with secret redaction wired in. */
const baseLoggerOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: PINO_REDACT_PATHS,
    censor: REDACTION_PLACEHOLDER,
  },
};

/**
 * The shared, configured `pino` logger instance. Other modules (e.g. the
 * error handler or app bootstrap) import this so all server logging flows
 * through a single redaction-aware logger.
 */
export const logger: Logger = pino(baseLoggerOptions);

/**
 * `pino-http` serializers that redact any secret-bearing headers or bodies
 * before they are written. Applying {@link redact} here guarantees that logged
 * request/response payloads (method, url, status, headers, body) never contain
 * a raw secret value (Req 10.5). Latency is captured by `pino-http` as
 * `responseTime`.
 */
const redactingSerializers: NonNullable<PinoHttpOptions['serializers']> = {
  req: (req: unknown) => redact(pino.stdSerializers.req(req as never)),
  res: (res: unknown) => redact(pino.stdSerializers.res(res as never)),
  err: (err: unknown) => redact(pino.stdSerializers.err(err as never)),
};

/**
 * Create the request-logging middleware (a `pino-http` instance) that logs the
 * method, url, status, and latency of each request while applying secret
 * redaction to any logged bodies and headers (Req 10.5).
 *
 * @param options optional overrides; supply a `logger` to route output to a
 *   custom destination (useful in tests).
 */
export function createRequestLogger(options: RequestLoggerOptions = {}): HttpLogger {
  return pinoHttp({
    logger: options.logger ?? logger,
    serializers: redactingSerializers,
  });
}

/**
 * Default request-logging middleware wired to the shared {@link logger}.
 * Mount this in the middleware pipeline (design step 2); use
 * {@link createRequestLogger} when a custom logger destination is needed.
 */
export const requestLogger: HttpLogger = createRequestLogger();

export default requestLogger;
