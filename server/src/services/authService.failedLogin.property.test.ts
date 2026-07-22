// Feature: user-registration-backend, Property 10: Failed login is generic and issues no tokens
/**
 * Property-based test for "failed login is generic and issues no tokens".
 *
 * Design reference: `design.md` -> "Property 10: Failed login is generic and
 * issues no tokens". A login that fails for ANY reason -- an unknown email or a
 * wrong password for an existing account -- records a `login-failure` auth event
 * and throws a single, generic {@link AuthenticationError} (`401`,
 * `authentication_failed`) that discloses nothing about which field was wrong,
 * and issues NO tokens (Req 3.5).
 *
 * This test drives {@link createAuthService} with lightweight mocks and no
 * datastore. For each generated pair of valid-format credentials it exercises
 * BOTH failure modes:
 *
 *   (A) unknown email    -> `usersRepo.findByEmail` resolves `null`
 *   (B) wrong password   -> `usersRepo.findByEmail` resolves a user, but
 *                           `hasher.verify` resolves `false`
 *
 * and asserts, for both:
 *   - `login(...)` rejects with an {@link AuthenticationError} whose
 *     `status === 401` and `code === 'authentication_failed'`,
 *   - the two modes throw the SAME message (non-disclosing: the error cannot be
 *     used to tell "no such account" from "wrong password"),
 *   - `tokenManager.issueAccessToken` and `issueRefreshToken` were NEVER called
 *     (no tokens issued), and
 *   - `auditLogger.recordLoginFailure` was called exactly once with the
 *     submitted (normalized) email.
 *
 * The global fast-check config (see `src/test/setup.ts`) runs a minimum of 100
 * iterations per property; `numRuns: 100` is asserted explicitly as a floor.
 *
 * Validates: Requirements 3.5
 */
import fc from 'fast-check';
import { createAuthService } from './authService';
import { AuthenticationError } from '../errors';
import type { UserRecord } from '../repositories/usersRepository';

// A valid-format login email: non-empty local + dotted domain, no whitespace,
// already lowercase so it survives normalization unchanged. Login validation
// only enforces presence + bounds, but a realistic address keeps the test honest.
const emailArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
      minLength: 1,
      maxLength: 16,
    }),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
      minLength: 1,
      maxLength: 12,
    }),
    fc.constantFrom('com', 'org', 'net', 'io', 'dev'),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

// A non-empty password within login bounds (1..254 chars). The 8..128 policy is
// intentionally NOT enforced at login, so any non-empty, in-bounds value is fine.
const passwordArb = fc.string({ minLength: 1, maxLength: 64 }).filter((p) => p.length > 0);

const credentialsArb = fc.record({ email: emailArb, password: passwordArb });

/** Build a plausible existing user for the wrong-password branch. */
function makeUser(email: string): UserRecord {
  return {
    id: 'user-1',
    email,
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abcdefghijklmnop$0123456789abcdef0123456789abcdef',
    role: 'user',
    createdAt: new Date(0),
  };
}

/**
 * Run one login attempt in the requested failure mode, returning the thrown
 * error together with the mocks used, so the caller can assert on both.
 */
async function runFailedLogin(
  mode: 'unknown-email' | 'wrong-password',
  email: string,
  password: string,
): Promise<{
  error: unknown;
  issueAccessToken: jest.Mock;
  issueRefreshToken: jest.Mock;
  recordLoginFailure: jest.Mock;
}> {
  const user = mode === 'unknown-email' ? null : makeUser(email);

  const usersRepo = {
    findByEmail: jest.fn(async () => user),
  };
  const hasher = {
    // Unknown-email: verify runs against the decoy hash and must fail.
    // Wrong-password: verify runs against the user's hash and must fail.
    verify: jest.fn(async () => false),
  };
  const issueAccessToken = jest.fn();
  const issueRefreshToken = jest.fn();
  const tokenManager = {
    issueAccessToken,
    issueRefreshToken,
    revokeRefreshToken: jest.fn(),
  };
  const recordLoginFailure = jest.fn(async () => undefined);
  const auditLogger = {
    recordLoginSuccess: jest.fn(async () => undefined),
    recordLoginFailure,
    recordLogout: jest.fn(async () => undefined),
  };

  const service = createAuthService({
    // Casts keep the mocks minimal while satisfying the injected surfaces.
    usersRepo: usersRepo as never,
    hasher: hasher as never,
    tokenManager: tokenManager as never,
    auditLogger: auditLogger as never,
  });

  let error: unknown;
  try {
    await service.login({ email, password }, { sourceIp: '203.0.113.7' });
  } catch (thrown) {
    error = thrown;
  }

  return { error, issueAccessToken, issueRefreshToken, recordLoginFailure };
}

describe('createAuthService.login - Property 10: failed login is generic and issues no tokens', () => {
  it('rejects both unknown-email and wrong-password with an identical generic 401 and issues no tokens (Req 3.5)', async () => {
    await fc.assert(
      fc.asyncProperty(credentialsArb, async ({ email, password }) => {
        const normalizedEmail = email.trim().toLowerCase();

        const unknown = await runFailedLogin('unknown-email', email, password);
        const wrong = await runFailedLogin('wrong-password', email, password);

        for (const result of [unknown, wrong]) {
          // A generic authentication error is thrown (401, stable code).
          expect(result.error).toBeInstanceOf(AuthenticationError);
          const err = result.error as AuthenticationError;
          expect(err.status).toBe(401);
          expect(err.code).toBe('authentication_failed');

          // No tokens are ever issued on a failed login.
          expect(result.issueAccessToken).not.toHaveBeenCalled();
          expect(result.issueRefreshToken).not.toHaveBeenCalled();

          // Exactly one login-failure event, recorded with the submitted email.
          expect(result.recordLoginFailure).toHaveBeenCalledTimes(1);
          expect(result.recordLoginFailure).toHaveBeenCalledWith(
            normalizedEmail,
            '203.0.113.7',
          );
        }

        // Non-disclosure: the two failure modes are indistinguishable by message.
        const unknownMessage = (unknown.error as AuthenticationError).message;
        const wrongMessage = (wrong.error as AuthenticationError).message;
        expect(unknownMessage).toBe(wrongMessage);
      }),
      { numRuns: 100 },
    );
  });
});
