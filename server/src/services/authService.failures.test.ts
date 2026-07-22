/**
 * Unit tests (example-based) for failure handling in the Auth_Service's
 * `login` and `logout` orchestration.
 *
 * Design reference: `design.md` -> "Services -> Auth_Service" and the
 * `/login` + `/logout` rows of "Endpoint Contracts".
 *
 * Two failure paths are exercised, both with plain Jest mocks and NO database:
 *
 * - Login, refresh-token persist failure: when the token manager's
 *   `issueRefreshToken` rejects (the record could not be persisted), login
 *   throws an {@link InternalError} (`500`) and returns NO tokens to the caller
 *   (Req 3.7). The in-memory access token issued moments earlier is discarded.
 *
 * - Logout, revocation write failure: logout is best-effort. When the
 *   revocation write (`revokeRefreshToken`) rejects — or even the owner lookup
 *   (`findByHash`) rejects — logout still resolves normally (the controller
 *   responds `200`) and leaves stored state unchanged (Req 5.5).
 *
 * Validates: Requirements 3.7, 5.5
 */
import {
  createAuthService,
  type AuthUsersRepo,
  type AuthPasswordHasher,
  type AuthTokenManager,
  type AuthAuditLogger,
  type AuthRefreshTokensRepo,
} from './authService';
import type { UserRecord } from '../repositories/usersRepository';
import type { RefreshTokenRecord } from '../repositories/refreshTokensRepository';
import { InternalError } from '../errors';

/** A valid login body: present email + non-empty password within bounds. */
const validBody = { email: 'user@example.com', password: 'correct horse' };

/** A stored user matching {@link validBody}'s email. */
const existingUser: UserRecord = {
  id: 'u1',
  email: validBody.email,
  passwordHash: 'stored-hash',
  role: 'user',
  createdAt: new Date(0),
};

describe('createAuthService - login refresh-token persist failure (Req 3.7)', () => {
  it('throws InternalError (500) and returns NO tokens when issueRefreshToken rejects', async () => {
    const usersRepo: AuthUsersRepo = {
      findByEmail: jest.fn().mockResolvedValue(existingUser),
    };
    const hasher: AuthPasswordHasher = {
      verify: jest.fn().mockResolvedValue(true),
    };
    const issueRefreshToken = jest.fn().mockRejectedValue(new Error('persist failed'));
    const tokenManager = {
      issueAccessToken: jest.fn().mockReturnValue('access:x'),
      issueRefreshToken,
      revokeRefreshToken: jest.fn(),
    } as unknown as AuthTokenManager;
    const recordLoginSuccess = jest.fn().mockResolvedValue(undefined);
    const auditLogger = {
      recordLoginSuccess,
      recordLoginFailure: jest.fn().mockResolvedValue(undefined),
      recordLogout: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthAuditLogger;

    const service = createAuthService({ usersRepo, hasher, tokenManager, auditLogger });

    // Login rejects with InternalError (500) — the persist failure surfaces as
    // a generic internal error and NO token pair is returned (it threw).
    const error = await service.login(validBody, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InternalError);
    expect((error as InternalError).status).toBe(500);

    // The refresh issuance was attempted (that is where it failed).
    expect(issueRefreshToken).toHaveBeenCalledTimes(1);

    // A success event is only recorded AFTER issuance succeeds — since issuance
    // failed, no `login-success` event was written.
    expect(recordLoginSuccess).not.toHaveBeenCalled();
  });
});

describe('createAuthService - logout revocation write failure (Req 5.5)', () => {
  /** An active (found, unrevoked) refresh-token record owned by `u1`. */
  const activeRecord: RefreshTokenRecord = {
    id: 'rt1',
    userId: 'u1',
    familyId: 'fam1',
    tokenHash: 'h:tok',
    revoked: false,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(0),
    replacedBy: null,
  };

  it('resolves (200) without throwing when revokeRefreshToken rejects', async () => {
    const refreshTokensRepo: AuthRefreshTokensRepo = {
      findByHash: jest.fn().mockResolvedValue(activeRecord),
    };
    const revokeRefreshToken = jest.fn().mockRejectedValue(new Error('write failed'));
    const tokenManager = {
      issueAccessToken: jest.fn(),
      issueRefreshToken: jest.fn(),
      revokeRefreshToken,
    } as unknown as AuthTokenManager;
    const auditLogger = {
      recordLoginSuccess: jest.fn().mockResolvedValue(undefined),
      recordLoginFailure: jest.fn().mockResolvedValue(undefined),
      recordLogout: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthAuditLogger;

    const service = createAuthService({
      refreshTokensRepo,
      tokenManager,
      auditLogger,
      hashRefreshToken: (t) => `h:${t}`,
    });

    // Logout swallows the write failure: it resolves to undefined and does not
    // throw, so the controller still responds 200 and stored state is unchanged.
    await expect(service.logout({ refreshToken: 'tok' }, {})).resolves.toBeUndefined();

    // The revocation write was attempted with the presented token.
    expect(revokeRefreshToken).toHaveBeenCalledWith('tok');
  });

  it('resolves (200) without throwing when the owner lookup (findByHash) rejects', async () => {
    const refreshTokensRepo: AuthRefreshTokensRepo = {
      findByHash: jest.fn().mockRejectedValue(new Error('lookup failed')),
    };
    const revokeRefreshToken = jest.fn().mockResolvedValue(undefined);
    const tokenManager = {
      issueAccessToken: jest.fn(),
      issueRefreshToken: jest.fn(),
      revokeRefreshToken,
    } as unknown as AuthTokenManager;

    const service = createAuthService({
      refreshTokensRepo,
      tokenManager,
      hashRefreshToken: (t) => `h:${t}`,
    });

    // A failing lookup is swallowed too: logout still resolves normally and the
    // revocation write is never reached (the lookup threw first).
    await expect(service.logout({ refreshToken: 'tok' }, {})).resolves.toBeUndefined();
    expect(revokeRefreshToken).not.toHaveBeenCalled();
  });
});
