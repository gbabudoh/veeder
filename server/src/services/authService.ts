import { validateLogin, validateRefresh } from '../validation';
import { passwordHasher } from '../security/passwordHasher';
import { usersRepository } from '../repositories/usersRepository';
import {
  getDefaultTokenManager,
  hashRefreshToken,
  type TokenManager,
} from '../security/tokenManager';
import { refreshTokensRepository } from '../repositories/refreshTokensRepository';
import { auditLogger, type AuditLogger } from './auditLogger';
import { AuthenticationError, InternalError, ValidationError } from '../errors';

/**
 * Auth_Service — login (and, later, logout) orchestration.
 *
 * Design reference: `design.md` → "Services → Auth_Service" and the
 * `/login` row of "Endpoint Contracts".
 *
 * This service implements **login** (task 12.1) and **logout** (task 12.5).
 * `createAuthService` composes injectable dependencies and returns an object
 * whose methods can be extended without changing the public surface.
 *
 * Logout flow (Req 5.1–5.3, 5.5, 11.4):
 * 1. Validate the payload with {@link validateRefresh}. An absent or malformed
 *    refresh token is a no-op — no revocation is attempted — yet the controller
 *    still responds `200` (Req 5.2, 5.3).
 * 2. Resolve the presented token's owner (via a hash lookup) so a `logout` auth
 *    event can be recorded for the correct account (Req 11.4), then best-effort
 *    revoke the token through the token manager (Req 5.1). Only a currently
 *    active token yields a `logout` event; unknown/already-revoked tokens do not.
 * 3. Every step is wrapped so any datastore failure is swallowed: logout never
 *    throws, leaves stored state unchanged on write failure, and the controller
 *    always responds `200` (Req 5.5).
 *
 * Login flow (Req 3.1–3.7, 11.2, 11.3):
 * 1. Validate the payload with {@link validateLogin}. A malformed request
 *    (missing/empty/over-254 email or password) throws a {@link ValidationError}
 *    which the controller maps to `400` (Req 3.6); credential verification is
 *    never attempted. The 8–128 password policy is intentionally NOT enforced
 *    at login.
 * 2. Look up the user by normalized email and verify the password. On an unknown
 *    email OR a bad password, record a `login-failure` auth event and throw a
 *    generic {@link AuthenticationError} (`401`) that discloses nothing about
 *    which field was wrong (Req 3.5, 11.3). To reduce a timing oracle that could
 *    reveal whether an email exists, the password verify runs against a fixed
 *    dummy hash when no user is found, so both branches do comparable work.
 * 3. On success, issue exactly one access token and exactly one refresh token.
 *    The refresh token is persisted before return (its issuer writes the record
 *    first; Req 3.3); if that persistence fails, an {@link InternalError}
 *    (`500`) is thrown and NO tokens are returned to the caller (Req 3.7). A
 *    `login-success` auth event is then recorded (Req 11.2) and the token pair
 *    is returned (Req 3.1, 3.4).
 *
 * No password or token value is ever logged or passed to the audit logger
 * (Req 11.6); only ids, the submitted email, and the source IP flow to auditing.
 */

/**
 * A fixed, valid argon2id hash used as a decoy when no user matches the
 * submitted email. Verifying the submitted password against this hash (which
 * will always fail) keeps the unknown-email branch's timing comparable to the
 * wrong-password branch, mitigating a user-enumeration timing oracle. It is not
 * a real credential and matches no password of interest.
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$iUbgbzHQmZ+Fnd6BZbOuDg$4lTZYxiHyNG4ArfZ2LL/ZWyyJbC/rpcF23Od/aIV/QE';

/** Result of a successful login: the issued token pair (Req 3.1, 3.4). */
export interface LoginResult {
  accessToken: string;
  refreshToken: string;
}

/** Per-request context for a login attempt. */
export interface AuthRequestContext {
  /** Source IP used for auth-event logging; a placeholder is recorded when absent (Req 11.2, 11.5). */
  sourceIp?: string;
}

/**
 * Minimal users-repository surface the Auth_Service depends on. Declaring only
 * what is used keeps the service unit-testable with a lightweight mock.
 */
export interface AuthUsersRepo {
  findByEmail: typeof usersRepository.findByEmail;
}

/** Minimal password-hasher surface the Auth_Service depends on. */
export interface AuthPasswordHasher {
  verify: typeof passwordHasher.verify;
}

/**
 * Minimal token-manager surface used by the Auth_Service: access + refresh
 * issuance for login and best-effort revocation for logout (Req 5.1).
 */
export interface AuthTokenManager {
  issueAccessToken: TokenManager['issueAccessToken'];
  issueRefreshToken: TokenManager['issueRefreshToken'];
  revokeRefreshToken: TokenManager['revokeRefreshToken'];
}

/** Minimal audit-logger surface used by login and logout. */
export interface AuthAuditLogger {
  recordLoginSuccess: AuditLogger['recordLoginSuccess'];
  recordLoginFailure: AuditLogger['recordLoginFailure'];
  recordLogout: AuditLogger['recordLogout'];
}

/**
 * Minimal refresh-tokens repository surface used by logout to resolve the
 * presented token's owner (for the `logout` auth event, Req 11.4) before
 * revoking it. Declaring only `findByHash` keeps the service unit-testable with
 * a lightweight mock. Structurally satisfied by the real
 * {@link refreshTokensRepository}.
 */
export interface AuthRefreshTokensRepo {
  findByHash: typeof refreshTokensRepository.findByHash;
}

/** Injectable dependencies for {@link createAuthService}. All default to real modules. */
export interface AuthServiceDeps {
  /** Users repository. Defaults to the real {@link usersRepository}. */
  usersRepo?: AuthUsersRepo;
  /** Password hasher. Defaults to the real {@link passwordHasher}. */
  hasher?: AuthPasswordHasher;
  /**
   * Token manager. Defaults to the lazily-configured
   * {@link getDefaultTokenManager} (resolved on first use so importing this
   * module never throws when the environment lacks a signing key — e.g. tests).
   * Inject a manager directly to unit-test without configuration.
   */
  tokenManager?: AuthTokenManager;
  /** Audit logger. Defaults to the real {@link auditLogger}. */
  auditLogger?: AuthAuditLogger;
  /**
   * Refresh-tokens repository, used by logout to resolve the presented token's
   * owner before revoking. Defaults to the real {@link refreshTokensRepository};
   * injectable so logout is unit-testable with a mock and no datastore.
   */
  refreshTokensRepo?: AuthRefreshTokensRepo;
  /**
   * One-way hash of an opaque refresh token, used to look up its stored record.
   * Defaults to the real {@link hashRefreshToken}; injectable for tests.
   */
  hashRefreshToken?: (token: string) => string;
}

/** The Auth_Service surface. Logout (task 12.5) will extend this interface. */
export interface AuthService {
  /**
   * Authenticate a login request and issue a token pair.
   *
   * @param body Raw, untrusted request body (validated internally).
   * @param context Request context carrying the source IP for auditing.
   * @throws ValidationError malformed request → controller maps to `400` (Req 3.6).
   * @throws AuthenticationError unknown email or bad password → `401`, generic (Req 3.5).
   * @throws InternalError refresh-token persistence failed → `500`, no tokens (Req 3.7).
   */
  login(body: unknown, context: AuthRequestContext): Promise<LoginResult>;

  /**
   * Log out by best-effort revoking the presented refresh token and recording a
   * `logout` auth event for its owner (Req 5.1, 11.4).
   *
   * This method NEVER throws and never surfaces an outcome: the controller
   * always responds `200` whether the token was valid, already revoked, absent,
   * or malformed, and even if the revocation write to the datastore fails
   * (Req 5.2, 5.3, 5.5). Any error is swallowed internally, leaving stored state
   * unchanged.
   *
   * @param body Raw, untrusted request body (validated internally).
   * @param context Request context (source IP); currently unused by logout.
   */
  logout(body: unknown, context: AuthRequestContext): Promise<void>;
}

/**
 * Create an Auth_Service bound to the given (optional) dependencies.
 *
 * With no arguments it uses the real repository, hasher, audit logger, and the
 * default token manager. The token manager is resolved lazily on first login so
 * that constructing the service (and importing this module) never triggers
 * configuration loading — mirroring `tokenManager`'s `getDefault` pattern.
 */
export function createAuthService(deps: AuthServiceDeps = {}): AuthService {
  const usersRepo = deps.usersRepo ?? usersRepository;
  const hasher = deps.hasher ?? passwordHasher;
  const audit = deps.auditLogger ?? auditLogger;
  const refreshTokensRepo = deps.refreshTokensRepo ?? refreshTokensRepository;
  const hashToken = deps.hashRefreshToken ?? hashRefreshToken;

  /** Resolve the token manager lazily to avoid import-time config throws. */
  function resolveTokenManager(): AuthTokenManager {
    return deps.tokenManager ?? getDefaultTokenManager();
  }

  async function login(body: unknown, context: AuthRequestContext): Promise<LoginResult> {
    // 1. Validate before any credential work (Req 3.6). Malformed → 400 via controller.
    const validation = validateLogin(body);
    if (!validation.ok) {
      throw new ValidationError(validation.fields);
    }
    const { email, password } = validation.value;

    // 2. Resolve the account and verify the password. When no user matches, we
    //    still run a verify against a decoy hash so the unknown-email and
    //    wrong-password branches take comparable time (anti-enumeration).
    const user = await usersRepo.findByEmail(email);
    const passwordMatches = await hasher.verify(
      user ? user.passwordHash : DUMMY_PASSWORD_HASH,
      password,
    );

    if (user === null || !passwordMatches) {
      // Record the failure (submitted email, source IP) then fail generically so
      // the response never reveals which field was wrong (Req 3.5, 11.3).
      await audit.recordLoginFailure(email, context.sourceIp);
      throw new AuthenticationError();
    }

    // 3. Success: issue exactly one access token and one refresh token. The
    //    refresh token is persisted by its issuer before it returns (Req 3.3).
    const tokenManager = resolveTokenManager();
    // Embed the account's current role in the access token's `role` claim so
    // authorization decisions need no extra lookup (Req 2.1).
    const accessToken = tokenManager.issueAccessToken(user.id, user.role);

    let issuedRefresh;
    try {
      issuedRefresh = await tokenManager.issueRefreshToken(user.id);
    } catch (error) {
      // Refresh persistence failed → 500 and NO tokens surfaced to the caller
      // (Req 3.7). The in-memory access token above is discarded, never returned.
      throw new InternalError('Token issuance failed');
    }

    // Record the successful login (user id + source IP) — non-blocking (Req 11.2).
    await audit.recordLoginSuccess(user.id, context.sourceIp);

    return { accessToken, refreshToken: issuedRefresh.token };
  }

  async function logout(body: unknown, _context: AuthRequestContext): Promise<void> {
    // 1. Parse the refresh token. An absent or malformed body is a no-op: no
    //    revocation write is attempted and the controller still responds 200
    //    (Req 5.2, 5.3).
    const validation = validateRefresh(body);
    if (!validation.ok) {
      return;
    }
    const { refreshToken } = validation.value;

    // 2. Everything below is best-effort. Any datastore failure (owner lookup
    //    or revocation write) is swallowed so the stored revocation state is
    //    left unchanged and the controller always responds 200 (Req 5.5).
    try {
      // Resolve the presented token's owner BEFORE revoking so we can record a
      // `logout` event for the correct account (Req 11.4). Only a currently
      // active (found, unrevoked) token has an owner worth logging out.
      const record = await refreshTokensRepo.findByHash(hashToken(refreshToken));
      const activeOwnerId = record !== null && !record.revoked ? record.userId : undefined;

      // Best-effort revoke of the presented token (Req 5.1). Unknown or
      // already-revoked tokens are a no-op inside the token manager.
      const tokenManager = resolveTokenManager();
      await tokenManager.revokeRefreshToken(refreshToken);

      // Record the `logout` event only when a matching active token/owner was
      // found — never for unknown or already-revoked tokens (Req 11.4). The
      // audit logger is already non-blocking.
      if (activeOwnerId !== undefined) {
        await audit.recordLogout(activeOwnerId);
      }
    } catch {
      // Swallow any failure: logout always returns normally so the controller
      // responds 200 and stored state is left unchanged (Req 5.2, 5.5).
    }
  }

  return { login, logout };
}

let defaultAuthService: AuthService | undefined;

/**
 * Lazily build (and memoize) the default Auth_Service wired to the real modules.
 *
 * Building lazily — rather than at import — avoids resolving the default token
 * manager (and thus loading configuration) until the service is first used,
 * mirroring {@link getDefaultTokenManager}.
 */
export function getAuthService(): AuthService {
  if (defaultAuthService === undefined) {
    defaultAuthService = createAuthService();
  }
  return defaultAuthService;
}

export default createAuthService;
