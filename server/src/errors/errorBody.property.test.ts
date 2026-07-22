// Feature: user-registration-backend, Property 21: Every error response has a well-formed, safe body
/**
 * Property 21: Every error response has a well-formed, safe body —
 * Validates: Requirements 9.1, 9.2
 *
 * For any {@link AppError} drawn from every subclass in the taxonomy,
 * {@link toErrorBody} always yields the shared wire shape
 * `{ error: { code, message, fields? } }` where:
 *   - `code` is a non-empty string of length 1..64 (Req 9.1),
 *   - `message` is a non-empty string of length 1..500 (Req 9.1),
 *   - the body has no extra keys beyond `code` / `message` / `fields`, and
 *   - the serialized body leaks no stack trace: it contains neither the literal
 *     substring `stack` nor the error's own `.stack` text (Req 9.2).
 *
 * A companion pair of example assertions exercises the unknown-error path
 * through the centralized handler: a plain (non-`AppError`) `Error` collapses to
 * `500` / `internal_error` with no stack in the response (Req 9.2). `toErrorBody`
 * itself only accepts `AppError`, so the generic-collapse behaviour is verified
 * where it actually lives — the handler — using a lightweight mock `res`.
 */
import fc from 'fast-check';

import {
  AppError,
  AuthenticationError,
  ConflictError,
  ERROR_CODE_MAX_LENGTH,
  ERROR_CODE_MIN_LENGTH,
  ERROR_MESSAGE_MAX_LENGTH,
  ERROR_MESSAGE_MIN_LENGTH,
  InternalError,
  NotFoundError,
  RateLimitError,
  TokenError,
  ValidationError,
  toErrorBody,
  type FieldError,
  type TokenErrorReason,
} from './index';
import { createErrorHandler } from '../middleware/errorHandler';

/**
 * Non-empty, trimmed text that never contains the substring `stack` (any case).
 * Constraining the alphabet away from that substring keeps the safety assertion
 * about the *body shape* rather than accidentally-generated content.
 */
const safeText: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 200 })
  .map((s) => s.trim())
  .filter((s) => s.length >= 1 && !s.toLowerCase().includes('stack'));

/** One-or-more field-level failures for {@link ValidationError}. */
const fieldErrors: fc.Arbitrary<FieldError[]> = fc.array(
  fc.record({ field: safeText, reason: safeText }),
  { minLength: 1, maxLength: 5 },
);

const tokenReason: fc.Arbitrary<TokenErrorReason> = fc.constantFrom(
  'missing',
  'invalid',
  'expired',
  'malformed',
  'revoked',
);

/**
 * A factory builds one concrete {@link AppError} from generated inputs. Using
 * `fc.constantFrom` over these factories draws uniformly across every subclass.
 */
type ErrorFactory = (
  message: string,
  fields: FieldError[],
  reason: TokenErrorReason,
) => AppError;

const errorFactories: fc.Arbitrary<ErrorFactory> = fc.constantFrom<ErrorFactory[]>(
  (message, fields) => new ValidationError(fields, message),
  (message) => new AuthenticationError(message),
  (message, _fields, reason) => new TokenError(reason, message),
  (message) => new ConflictError(message),
  (message) => new NotFoundError(message),
  (message) => new RateLimitError(message),
  (message) => new InternalError(message),
);

describe('Property 21: Every error response has a well-formed, safe body (Req 9.1, 9.2)', () => {
  it('toErrorBody yields a well-formed, stack-free body for every AppError subclass', () => {
    fc.assert(
      fc.property(
        errorFactories,
        safeText,
        fieldErrors,
        tokenReason,
        (make, message, fields, reason) => {
          const err = make(message, fields, reason);
          const body = toErrorBody(err);

          // Top-level shape: exactly one key, `error`.
          expect(Object.keys(body)).toEqual(['error']);

          // No extra keys beyond code / message / fields.
          const innerKeys = Object.keys(body.error).sort();
          const allowed = ['code', 'fields', 'message'];
          expect(innerKeys.every((k) => allowed.includes(k))).toBe(true);

          // code: non-empty string, length 1..64.
          expect(typeof body.error.code).toBe('string');
          expect(body.error.code.length).toBeGreaterThanOrEqual(ERROR_CODE_MIN_LENGTH);
          expect(body.error.code.length).toBeLessThanOrEqual(ERROR_CODE_MAX_LENGTH);

          // message: non-empty string, length 1..500.
          expect(typeof body.error.message).toBe('string');
          expect(body.error.message.length).toBeGreaterThanOrEqual(
            ERROR_MESSAGE_MIN_LENGTH,
          );
          expect(body.error.message.length).toBeLessThanOrEqual(
            ERROR_MESSAGE_MAX_LENGTH,
          );

          // fields, when present, is an array of {field, reason}.
          if ('fields' in body.error) {
            expect(Array.isArray(body.error.fields)).toBe(true);
          }

          // No stack trace leaks into the serialized body (Req 9.2).
          const serialized = JSON.stringify(body);
          expect(serialized.includes('stack')).toBe(false);
          if (typeof err.stack === 'string' && err.stack.length > 0) {
            expect(serialized.includes(err.stack)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('collapses an unknown (non-AppError) error to 500 / internal_error with no stack', () => {
    const handler = createErrorHandler();

    let statusCode: number | undefined;
    let body: unknown;
    const res = {
      headersSent: false,
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
      setHeader() {
        return this;
      },
    };
    const next = jest.fn();

    handler(
      new Error('boom: internal detail with a stack trace'),
      {} as never,
      res as never,
      next,
    );

    expect(statusCode).toBe(500);
    const typed = body as { error: { code: string; message: string } };
    expect(typed.error.code).toBe('internal_error');
    expect(typed.error.message.length).toBeGreaterThanOrEqual(ERROR_MESSAGE_MIN_LENGTH);
    expect(JSON.stringify(body).includes('stack')).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });
});
