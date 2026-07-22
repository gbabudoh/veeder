/**
 * Request-payload validation for the Auth API.
 *
 * Design reference: `design.md` -> "Validation_Component". Each validator
 * returns a discriminated {@link ValidationResult}: either a normalized value
 * (`ok: true`) or a list of {@link FieldError}s (`ok: false`), one entry per
 * field that failed a rule (Req 2.5, 9.4).
 *
 * Email normalization (trim + lowercase) happens here, before uniqueness
 * checks and persistence (Req 2.6): the normalized email is what callers must
 * use for lookups and inserts.
 *
 * Requirements covered:
 * - Registration format/length/presence rules: Req 1.1, 2.1-2.5.
 * - Email normalization: Req 2.6.
 * - Login malformed-request rules (presence + bounds, no password policy):
 *   Req 3.6.
 * - Refresh token presence: Req 4.5.
 * - Field-level error shape: Req 9.4.
 */

import { z } from 'zod';
import { FieldError } from '../errors';

/** Maximum length of an email address, in characters (Req 1.1, 2.2). */
export const EMAIL_MAX_LENGTH = 254;

/** Inclusive password length bounds for registration (Req 1.1, 2.3). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Normalized, validated registration input. */
export interface RegistrationInput {
  /** Trimmed + lowercased email (Req 2.6). */
  email: string;
  /** The raw password (never trimmed). */
  password: string;
}

/** Normalized, validated login input. */
export interface LoginInput {
  /** Trimmed + lowercased email (Req 2.6). */
  email: string;
  /** The raw password (never trimmed). */
  password: string;
}

/** Validated refresh input. */
export interface RefreshInput {
  refreshToken: string;
}

/**
 * The result of a validator: a normalized value on success, or a list of
 * field-level failures on error (one entry per failed field).
 */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; fields: FieldError[] };

/**
 * Whether an email string satisfies the format rule: exactly one "@", a
 * non-empty local part, a non-empty domain that contains at least one ".",
 * and no embedded whitespace (Req 1.1, 2.1). The value is assumed already
 * trimmed by the caller.
 */
function isValidEmailFormat(email: string): boolean {
  if (/\s/.test(email)) {
    return false;
  }
  const atIndex = email.indexOf('@');
  if (atIndex === -1) {
    return false;
  }
  // Exactly one "@".
  if (email.indexOf('@', atIndex + 1) !== -1) {
    return false;
  }
  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (localPart.length === 0 || domain.length === 0) {
    return false;
  }
  // At least one "." somewhere inside the domain (not leading/trailing).
  const dotIndex = domain.indexOf('.');
  if (dotIndex <= 0 || dotIndex === domain.length - 1) {
    return false;
  }
  return true;
}

/**
 * Coerce an arbitrary request body into a keyed record so that individual
 * fields can be inspected. Non-object bodies (null, arrays, primitives) yield
 * an empty record, which makes every expected field read as `undefined` and
 * therefore "missing" (Req 2.4, 3.6, 4.5).
 */
function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}

/** Reduce a Zod error to a single reason message for one field. */
function firstReason(error: z.ZodError): string {
  const [issue] = error.issues;
  return issue?.message ?? 'Invalid value';
}

// --- Registration ---------------------------------------------------------

const registrationEmailSchema = z
  .string({
    required_error: 'Email is required',
    invalid_type_error: 'Email is required',
  })
  .superRefine((value, ctx) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Email is required' });
      return;
    }
    if (trimmed.length > EMAIL_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Email must be at most ${EMAIL_MAX_LENGTH} characters`,
      });
    }
    if (!isValidEmailFormat(trimmed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Email must be a valid email address',
      });
    }
  })
  .transform((value) => value.trim().toLowerCase());

const registrationPasswordSchema = z
  .string({
    required_error: 'Password is required',
    invalid_type_error: 'Password is required',
  })
  .superRefine((value, ctx) => {
    if (value.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Password is required' });
      return;
    }
    if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`,
      });
    }
  });

/**
 * Validate a registration payload. On success the returned value carries the
 * normalized (trimmed + lowercased) email and the raw password. On failure it
 * carries one {@link FieldError} for each field that violated a rule -- all
 * failing fields are reported together (Req 1.1, 2.1-2.6, 9.4).
 */
export function validateRegistration(body: unknown): ValidationResult<RegistrationInput> {
  const source = asRecord(body);
  const fields: FieldError[] = [];

  const emailResult = registrationEmailSchema.safeParse(source.email);
  if (!emailResult.success) {
    fields.push({ field: 'email', reason: firstReason(emailResult.error) });
  }

  const passwordResult = registrationPasswordSchema.safeParse(source.password);
  if (!passwordResult.success) {
    fields.push({ field: 'password', reason: firstReason(passwordResult.error) });
  }

  if (!emailResult.success || !passwordResult.success) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: { email: emailResult.data, password: passwordResult.data },
  };
}

// --- Login -----------------------------------------------------------------

const loginEmailSchema = z
  .string({
    required_error: 'Email is required',
    invalid_type_error: 'Email is required',
  })
  .superRefine((value, ctx) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Email is required' });
      return;
    }
    if (trimmed.length > EMAIL_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Email must be at most ${EMAIL_MAX_LENGTH} characters`,
      });
    }
  })
  .transform((value) => value.trim().toLowerCase());

const loginPasswordSchema = z
  .string({
    required_error: 'Password is required',
    invalid_type_error: 'Password is required',
  })
  .superRefine((value, ctx) => {
    if (value.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Password is required' });
      return;
    }
    if (value.length > EMAIL_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Password must be at most ${EMAIL_MAX_LENGTH} characters`,
      });
    }
  });

/**
 * Validate a login payload. Only presence and basic bounds are enforced
 * (missing, empty, or longer than 254 characters) so that malformed requests
 * are rejected before any credential verification; the 8-128 password policy
 * is intentionally NOT applied here (Req 3.6). On success the normalized email
 * and raw password are returned.
 */
export function validateLogin(body: unknown): ValidationResult<LoginInput> {
  const source = asRecord(body);
  const fields: FieldError[] = [];

  const emailResult = loginEmailSchema.safeParse(source.email);
  if (!emailResult.success) {
    fields.push({ field: 'email', reason: firstReason(emailResult.error) });
  }

  const passwordResult = loginPasswordSchema.safeParse(source.password);
  if (!passwordResult.success) {
    fields.push({ field: 'password', reason: firstReason(passwordResult.error) });
  }

  if (!emailResult.success || !passwordResult.success) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: { email: emailResult.data, password: passwordResult.data },
  };
}

// --- Refresh ---------------------------------------------------------------

const refreshTokenSchema = z
  .string({
    required_error: 'Refresh token is required',
    invalid_type_error: 'Refresh token is required',
  })
  .refine((value) => value.length > 0, {
    message: 'Refresh token is required',
  });

/**
 * Validate a refresh payload. The `refreshToken` field must be a present,
 * non-empty string; a missing or empty token yields a field error (Req 4.5).
 */
export function validateRefresh(body: unknown): ValidationResult<RefreshInput> {
  const source = asRecord(body);

  const tokenResult = refreshTokenSchema.safeParse(source.refreshToken);
  if (!tokenResult.success) {
    return {
      ok: false,
      fields: [{ field: 'refreshToken', reason: firstReason(tokenResult.error) }],
    };
  }

  return { ok: true, value: { refreshToken: tokenResult.data } };
}
