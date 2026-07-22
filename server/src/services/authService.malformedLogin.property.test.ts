// Feature: user-registration-backend, Property 11: Malformed login is rejected before credential verification
/**
 * Property-based test for the malformed-login short-circuit.
 *
 * Design reference: `design.md` -> "Property 11: Malformed login is rejected
 * before credential verification". This test drives
 * {@link createAuthService} with fully-mocked dependencies and NO database. For
 * any malformed login body (missing/empty/whitespace email or password, an
 * over-254-character email, an over-254-character/empty password, or a body
 * that is not a plain object) the service MUST:
 *
 *   1. reject with a {@link ValidationError} carrying HTTP status 400 (Req 3.6);
 *   2. NOT look up the user (`usersRepo.findByEmail` never called);
 *   3. NOT verify any credential (`hasher.verify` never called);
 *   4. NOT issue any token (`issueAccessToken` / `issueRefreshToken` never
 *      called); and
 *   5. NOT write any auth event.
 *
 * Together these prove validation short-circuits before any credential
 * verification or side effect.
 *
 * Validates: Requirements 3.6
 */
import fc from 'fast-check';
import { createAuthService } from './authService';
import { ValidationError } from '../errors';

// --- Malformed field generators -------------------------------------------

/** Non-string values: `undefined` reads as "missing", others as wrong-type. */
const nonStringValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.integer(),
  fc.boolean(),
  fc.constant({}),
  fc.array(fc.anything(), { maxLength: 3 }),
);

/** Empty or whitespace-only strings — both trim to empty and fail email presence. */
const emptyOrWhitespace: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(' ', '\t', '\n', '\r'),
  { minLength: 0, maxLength: 8 },
);

/** A string whose trimmed length exceeds the 254-character bound. */
const overLongString: fc.Arbitrary<string> = fc
  .integer({ min: 255, max: 400 })
  .map((n) => 'a'.repeat(n));

/** Values that always fail login email validation (missing/empty/whitespace/over-254). */
const malformedEmail: fc.Arbitrary<unknown> = fc.oneof(
  nonStringValue,
  emptyOrWhitespace,
  overLongString,
);

/** Values that always fail login password validation (missing/empty/over-254). */
const malformedPassword: fc.Arbitrary<unknown> = fc.oneof(
  nonStringValue,
  fc.constant(''),
  overLongString,
);

// --- Valid field generators (used to isolate a single malformed field) -----

const TOKEN_CHARS =
  'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
const token = (minLength: number, maxLength: number) =>
  fc.stringOf(fc.constantFrom(...TOKEN_CHARS), { minLength, maxLength });

/** A well-formed address that passes login validation. */
const validEmail: fc.Arbitrary<string> = fc
  .record({ local: token(1, 10), domain: token(1, 10), tld: token(1, 5) })
  .map(({ local, domain, tld }) => `${local}@${domain}.${tld}`);

/** A password that passes login validation (non-empty, <= 254 chars). */
const validPassword: fc.Arbitrary<string> = token(8, 64);

// --- Malformed body generator ----------------------------------------------

/**
 * Object bodies where at least one field is guaranteed malformed, so the
 * overall body always fails {@link validateLogin}.
 */
const malformedObjectBody: fc.Arbitrary<unknown> = fc.oneof(
  fc.record({ email: malformedEmail, password: validPassword }),
  fc.record({ email: validEmail, password: malformedPassword }),
  fc.record({ email: malformedEmail, password: malformedPassword }),
);

/** Bodies that are not plain objects — every expected field reads as missing. */
const nonObjectBody: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.string(),
  fc.array(fc.anything(), { maxLength: 3 }),
);

const malformedBody: fc.Arbitrary<unknown> = fc.oneof(
  malformedObjectBody,
  nonObjectBody,
);

// --- Mocks that MUST NOT be called on malformed input -----------------------

function makeMocks() {
  const usersRepo = { findByEmail: jest.fn() };
  const hasher = { verify: jest.fn() };
  const tokenManager = {
    issueAccessToken: jest.fn(),
    issueRefreshToken: jest.fn(),
    revokeRefreshToken: jest.fn(),
  };
  const auditLogger = {
    recordLoginSuccess: jest.fn(),
    recordLoginFailure: jest.fn(),
    recordLogout: jest.fn(),
  };
  return { usersRepo, hasher, tokenManager, auditLogger };
}

describe('authService - Property 11: malformed login is rejected before credential verification', () => {
  it('rejects malformed login with a 400 ValidationError without any credential work (Req 3.6)', async () => {
    await fc.assert(
      fc.asyncProperty(malformedBody, async (body) => {
        const { usersRepo, hasher, tokenManager, auditLogger } = makeMocks();
        const service = createAuthService({
          usersRepo,
          hasher,
          tokenManager,
          auditLogger,
        });

        // The login must reject with a ValidationError carrying status 400.
        let caught: unknown;
        try {
          await service.login(body, {});
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(ValidationError);
        expect((caught as ValidationError).status).toBe(400);

        // Short-circuit: no credential lookup or verification happened.
        expect(usersRepo.findByEmail).not.toHaveBeenCalled();
        expect(hasher.verify).not.toHaveBeenCalled();

        // No tokens were issued.
        expect(tokenManager.issueAccessToken).not.toHaveBeenCalled();
        expect(tokenManager.issueRefreshToken).not.toHaveBeenCalled();

        // No auth event was written.
        expect(auditLogger.recordLoginSuccess).not.toHaveBeenCalled();
        expect(auditLogger.recordLoginFailure).not.toHaveBeenCalled();
        expect(auditLogger.recordLogout).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});
