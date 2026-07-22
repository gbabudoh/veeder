// Feature: user-registration-backend, Property 7: Successful login issues exactly one access and one refresh token
/**
 * Property 7 — Successful login issues exactly one access and one refresh token.
 *
 * Design reference: `design.md` → "Correctness Properties → Property 7".
 * **Validates: Requirements 3.1, 3.4**
 *
 * For any registered user authenticating with the correct password, `login`
 * returns exactly one access token and exactly one refresh token, records a
 * single `login-success` event for that user, and never records a failure.
 *
 * This is a pure unit-level property: no database is used. The users repo,
 * hasher, token manager, and audit logger are all injected mocks, so the test
 * exercises only the Auth_Service orchestration (token issuance + auditing).
 */

import fc from 'fast-check';
import { createAuthService } from './authService';

/**
 * Build a fresh set of mocked dependencies for a single login attempt.
 *
 * - `usersRepo.findByEmail` resolves a user whose email is the (normalized)
 *   value passed in, so the credential lookup always succeeds.
 * - `hasher.verify` always reports the password matches.
 * - `tokenManager` issues deterministic access/refresh tokens keyed by user id
 *   and records call counts via jest mock functions.
 * - `auditLogger` records success/failure/logout via jest mock functions.
 */
function buildDeps(email: string) {
  const user = {
    id: `user-${email}`,
    email,
    passwordHash: 'h',
    role: 'user' as const,
    createdAt: new Date(),
  };

  const usersRepo = {
    findByEmail: jest.fn(async (_email: string) => user),
  };

  const hasher = {
    verify: jest.fn(async () => true),
  };

  const tokenManager = {
    issueAccessToken: jest.fn((uid: string) => `access:${uid}`),
    issueRefreshToken: jest.fn(async (uid: string) => ({
      token: `refresh:${uid}`,
      record: {
        id: 'r1',
        userId: uid,
        familyId: 'f',
        tokenHash: 'th',
        revoked: false,
        expiresAt: new Date(Date.now() + 1e6),
        createdAt: new Date(),
        replacedBy: null,
      },
    })),
    revokeRefreshToken: jest.fn(async () => undefined),
  };

  const auditLogger = {
    recordLoginSuccess: jest.fn(async () => undefined),
    recordLoginFailure: jest.fn(async () => undefined),
    recordLogout: jest.fn(async () => undefined),
  };

  return { user, usersRepo, hasher, tokenManager, auditLogger };
}

describe('Property 7: Successful login issues exactly one access and one refresh token', () => {
  it('issues exactly one access + one refresh token and records a single login-success', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A well-formed, normalized email (lowercase, no whitespace) and a
        // valid-length password. Login validation only enforces presence and
        // bounds, so these constrained generators stay inside the valid input
        // space for a successful authentication.
        fc
          .tuple(
            fc.stringMatching(/^[a-z0-9]{1,20}$/),
            fc.stringMatching(/^[a-z0-9]{1,20}$/),
          )
          .map(([local, domain]) => `${local}@${domain}.com`),
        fc.string({ minLength: 8, maxLength: 128 }),
        async (email, password) => {
          const { user, usersRepo, hasher, tokenManager, auditLogger } =
            buildDeps(email);

          const service = createAuthService({
            usersRepo,
            hasher,
            tokenManager,
            auditLogger,
          });

          const result = await service.login(
            { email, password },
            { sourceIp: '203.0.113.7' },
          );

          // Exactly one access token and one refresh token issued.
          expect(tokenManager.issueAccessToken).toHaveBeenCalledTimes(1);
          expect(tokenManager.issueRefreshToken).toHaveBeenCalledTimes(1);

          // Result carries exactly the two token fields, both non-empty strings.
          expect(Object.keys(result).sort()).toEqual([
            'accessToken',
            'refreshToken',
          ]);
          expect(typeof result.accessToken).toBe('string');
          expect(typeof result.refreshToken).toBe('string');
          expect(result.accessToken.length).toBeGreaterThan(0);
          expect(result.refreshToken.length).toBeGreaterThan(0);

          // Exactly one login-success recorded for this user; no failure.
          expect(auditLogger.recordLoginSuccess).toHaveBeenCalledTimes(1);
          expect(auditLogger.recordLoginSuccess).toHaveBeenCalledWith(
            user.id,
            expect.anything(),
          );
          expect(auditLogger.recordLoginFailure).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
