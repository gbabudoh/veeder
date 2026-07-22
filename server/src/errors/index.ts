/**
 * Typed error taxonomy and structured error-body types.
 *
 * Design reference: `design.md` → "Error Handling" and "DTOs / API Contracts".
 * Requirement 9.1: every error response carries a non-empty machine-readable
 * `code` (1..64 chars) and a non-empty human-readable `message` (1..500 chars),
 * with an optional field-level list for validation errors (Req 9.4).
 *
 * Controllers and middleware throw these typed errors; a single centralized
 * error handler (task 4.2) converts them into the {@link ErrorBody} shape using
 * {@link toErrorBody}. Keeping the shape in one place guarantees the response
 * invariant (Property 21).
 */

/** Bounds for the machine-readable error code (Req 9.1). */
export const ERROR_CODE_MIN_LENGTH = 1;
export const ERROR_CODE_MAX_LENGTH = 64;

/** Bounds for the human-readable error message (Req 9.1). */
export const ERROR_MESSAGE_MIN_LENGTH = 1;
export const ERROR_MESSAGE_MAX_LENGTH = 500;

/**
 * A single field-level validation failure (Req 9.4).
 * `field` identifies the offending input; `reason` is a human-readable
 * explanation of why it failed.
 */
export interface FieldError {
  field: string;
  reason: string;
}

/**
 * The single, shared shape for every error response body (Req 9.1).
 * `fields` is present only for validation errors (Req 9.4).
 */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: FieldError[];
  };
}

/**
 * Base class for all application errors. Carries the HTTP `status` to return
 * and a stable machine-readable `code`. Subclasses fix sensible defaults for
 * each error category.
 */
export abstract class AppError extends Error {
  /** HTTP status code to send for this error. */
  public readonly status: number;

  /** Stable, machine-readable error code (Req 9.1). */
  public readonly code: string;

  /** Field-level failures, present for validation errors (Req 9.4). */
  public readonly fields?: FieldError[];

  protected constructor(
    status: number,
    code: string,
    message: string,
    fields?: FieldError[],
  ) {
    super(message);
    // Restore the prototype chain: required when targeting ES5/ES2015+ with
    // extended built-ins so `instanceof` works across transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    if (fields !== undefined) {
      this.fields = fields;
    }
  }

  /** Build the wire-format error body for this error. */
  public toErrorBody(): ErrorBody {
    return toErrorBody(this);
  }
}

/**
 * 400 — request failed input validation. Carries one {@link FieldError} per
 * field that failed (Req 2.x, 9.4).
 */
export class ValidationError extends AppError {
  public override readonly fields: FieldError[];

  constructor(fields: FieldError[], message = 'One or more fields are invalid') {
    super(400, 'validation_error', message, fields);
    this.fields = fields;
  }
}

/**
 * 401 — login credentials could not be verified. The message is intentionally
 * generic so it does not disclose which field was wrong (Req 3.5, 1.5).
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(401, 'authentication_failed', message);
  }
}

/**
 * The specific reason an access/refresh token was rejected. Each reason maps to
 * a distinct machine-readable code so clients can react precisely
 * (token guard + refresh: Req 4, 6, 7).
 */
export type TokenErrorReason =
  | 'missing'
  | 'invalid'
  | 'expired'
  | 'malformed'
  | 'revoked';

const TOKEN_ERROR_CODES: Record<TokenErrorReason, string> = {
  missing: 'auth_required',
  invalid: 'invalid_token',
  expired: 'token_expired',
  malformed: 'token_malformed',
  revoked: 'invalid_token',
};

const TOKEN_ERROR_MESSAGES: Record<TokenErrorReason, string> = {
  missing: 'Authentication is required',
  invalid: 'The token is invalid',
  expired: 'The token is expired',
  malformed: 'The token is malformed',
  revoked: 'The token is invalid or revoked',
};

/**
 * 401 — an access or refresh token was missing, invalid, expired, malformed, or
 * revoked. The `reason` selects an appropriate stable `code`.
 */
export class TokenError extends AppError {
  /** The classification of the token failure. */
  public readonly reason: TokenErrorReason;

  constructor(reason: TokenErrorReason, message?: string) {
    super(401, TOKEN_ERROR_CODES[reason], message ?? TOKEN_ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

/**
 * 409 — the account already exists. The message does not reveal whether a
 * password matched (Req 1.5).
 */
export class ConflictError extends AppError {
  constructor(message = 'An account with these details already exists') {
    super(409, 'duplicate_account', message);
  }
}

/**
 * 404 — the referenced account no longer exists (Req 7.5).
 */
export class NotFoundError extends AppError {
  constructor(message = 'Account not found') {
    super(404, 'account_not_found', message);
  }
}

/**
 * 403 — the caller is authenticated but lacks the administrator privileges
 * required for the requested resource (Req 3.3, 3.4). The message does not
 * disclose anything about the protected resource.
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Administrator privileges are required') {
    super(403, 'admin_required', message);
  }
}

/**
 * 429 — a rate limit was exceeded (Req 8). Optionally carries the number of
 * seconds until requests are permitted again, used to populate `Retry-After`.
 */
export class RateLimitError extends AppError {
  /** Seconds until the caller may retry, when known (integer, 1..60 per Req 8). */
  public readonly retryAfterSeconds?: number;

  constructor(message = 'Too many requests', retryAfterSeconds?: number) {
    super(429, 'rate_limited', message);
    if (retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = retryAfterSeconds;
    }
  }
}

/**
 * 500 — fallback for anything unhandled. The message is generic so no internal
 * details leak to the client (Req 9.2).
 */
export class InternalError extends AppError {
  constructor(message = 'An internal error occurred') {
    super(500, 'internal_error', message);
  }
}

/**
 * Convert an {@link AppError} into the wire-format {@link ErrorBody}.
 *
 * Only `code`, `message`, and (when present) `fields` are serialized — never
 * stack traces or internal details (Req 9.2). Used by the centralized error
 * handler (task 4.2).
 */
export function toErrorBody(error: AppError): ErrorBody {
  const body: ErrorBody = {
    error: {
      code: error.code,
      message: error.message,
    },
  };
  if (error.fields !== undefined) {
    body.error.fields = error.fields;
  }
  return body;
}
