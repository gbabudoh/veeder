import crypto from 'node:crypto';

import jwt from 'jsonwebtoken';

import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, loadConfig } from '../config';
import { knex as sharedKnex } from '../db/knex';
import {
  refreshTokensRepository,
  type RefreshTokenRecord,
} from '../repositories/refreshTokensRepository';
import { usersRepository, type Role } from '../repositories/usersRepository';
import type { Knex } from 'knex';

/**
 * Token_Manager component — access-token issuance and verification.
 *
 * Design reference: `design.md` → "Token_Manager (`tokenManager`)".
 *
 * Access tokens are signed JWTs (HS256) whose lifetime is a fixed contract
 * value of 900 seconds (`exp = iat + 900`; Req 3.2, 4.1). Verification classifies
 * every inbound token into exactly one outcome — accepted / missing / invalid /
 * expired / malformed (Req 6.1–6.5) — and never throws for verification
 * failures: it returns the classification so the auth-guard middleware
 * (task 14.7) can map it to the appropriate {@link TokenError} reason.
 *
 * The signing key is injected via {@link createTokenManager} so this module is
 * unit-testable without any environment. {@link getDefaultTokenManager} builds a
 * lazily-configured instance from {@link loadConfig} to avoid throwing at import
 * time (e.g., in tests that do not set `JWT_SIGNING_KEY`).
 *
 * Refresh-token issuance (task 8.4) is implemented here: refresh tokens are
 * opaque, high-entropy CSPRNG secrets that are persisted only as a one-way
 * SHA-256 hash (Req 10.3) with `expires_at = created_at + 2,592,000s` (Req 3.3),
 * and the plaintext is returned to the caller exactly once. Rotation/reuse
 * detection and revocation (task 8.7) extend this same module/factory and are
 * intentionally not implemented here.
 *
 * No token value is ever logged by this module.
 */

/** The HMAC algorithm used to sign and verify access tokens. */
const ACCESS_TOKEN_ALGORITHM = 'HS256' as const;

/**
 * Number of random bytes in an opaque refresh token. 32 bytes = 256 bits of
 * entropy from a CSPRNG, which comfortably exceeds the design's "≥ 256 bits"
 * requirement and is safe to store as a plain SHA-256 hash (the token is
 * already high-entropy, unlike a human password).
 */
const REFRESH_TOKEN_BYTES = 32;

/**
 * Compute the one-way lookup hash of an opaque refresh token.
 *
 * A refresh token is a high-entropy random secret, so a fast, deterministic
 * SHA-256 digest (hex) is an appropriate one-way transform: it is indexable for
 * a single-read lookup and never reversible to the plaintext (Req 10.3). Only
 * this hash is ever persisted; the plaintext is returned to the caller once.
 *
 * Exported because rotation/verification (task 8.7) must hash an incoming token
 * to look up its stored record.
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * `jsonwebtoken` error messages that indicate the token could not be parsed as
 * a well-formed token (as opposed to a signature/validation failure). These map
 * to the `malformed` outcome (Req 6.5); all other {@link jwt.JsonWebTokenError}
 * messages map to `invalid` (Req 6.3).
 */
const MALFORMED_MESSAGES: ReadonlySet<string> = new Set([
  'jwt malformed',
  'invalid token',
  'jwt must be provided',
]);

/**
 * The result of verifying an access token. A discriminated union so callers can
 * switch on `status` and, only for `accepted`, read the authenticated `userId`.
 */
export type AccessTokenVerification =
  | { status: 'accepted'; userId: string; role: Role }
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'malformed' };

/** The set of defined role values a verified token's `role` claim may carry. */
const DEFINED_ROLES: ReadonlySet<string> = new Set<Role>(['user', 'admin']);

/**
 * Normalize a raw `role` claim to a defined {@link Role}. An absent claim or any
 * value that is not exactly `'user'` or `'admin'` collapses to `'user'` so the
 * authorization middleware never observes an undefined or out-of-set role
 * (Req 2.2, 2.5).
 */
function normalizeRole(claim: unknown): Role {
  return typeof claim === 'string' && DEFINED_ROLES.has(claim) ? (claim as Role) : 'user';
}

/** Optional inputs to {@link TokenManager.issueRefreshToken}. */
export interface IssueRefreshTokenOptions {
  /**
   * Rotation lineage to attach the new token to. When omitted, a fresh family
   * id is generated (a brand-new session). Rotation (task 8.7) passes the
   * existing family id so the successor shares its predecessor's lineage.
   */
  familyId?: string;
}

/**
 * The result of issuing a refresh token: the plaintext token (returned to the
 * caller exactly once) and the persisted {@link RefreshTokenRecord} (which holds
 * only the hash, never the plaintext).
 */
export interface IssuedRefreshToken {
  /** The opaque plaintext token — surfaced once and never persisted. */
  token: string;
  /** The persisted record (hash only, plus id/family/expiry metadata). */
  record: RefreshTokenRecord;
}

/**
 * The outcome of {@link TokenManager.rotateRefreshToken}. A discriminated union
 * so the refresh controller can switch on `status` and map each case to its HTTP
 * result (Req 4.1–4.6).
 */
export type RotateResult =
  | {
      /** The presented token was valid and active; a successor was issued. */
      status: 'rotated';
      /** Owner of the rotated session. */
      userId: string;
      /** A freshly signed access token (`exp = now + accessTtl`; Req 4.1). */
      accessToken: string;
      /** The successor opaque refresh token, returned exactly once (Req 4.2). */
      refreshToken: string;
      /** The persisted successor record (shares the predecessor's family id). */
      record: RefreshTokenRecord;
    }
  | {
      /**
       * The token was not found or is expired — an unknown/expired credential
       * that is NOT a detectable reuse (Req 4.4).
       */
      status: 'invalid';
    }
  | {
      /**
       * The presented token exists but was already revoked (previously rotated),
       * indicating reuse: the entire family has been revoked (Req 4.6).
       */
      status: 'reuse';
      /** Owner of the compromised session. */
      userId: string;
    };

/**
 * The Token_Manager surface. Rotate/revoke methods are added by task 8.7 and
 * will extend this interface.
 */
export interface TokenManager {
  /**
   * Issue a signed access token for `userId` whose expiry is issuance + the
   * configured TTL (default 900s; Req 3.2, 4.1).
   *
   * Embeds exactly one `role` claim carrying the account's current role
   * (Req 2.1). When no role is supplied the claim defaults to `'user'`
   * (Req 2.2).
   */
  issueAccessToken(userId: string, role?: Role): string;

  /**
   * Classify an inbound access token into exactly one {@link AccessTokenVerification}
   * outcome. Never throws for verification failures (Req 6.1–6.5).
   */
  verifyAccessToken(token: string | undefined): AccessTokenVerification;

  /**
   * Issue an opaque, high-entropy refresh token for `userId`.
   *
   * A CSPRNG token is generated, only its SHA-256 hash is persisted with
   * `expires_at = created_at + refreshTtlSeconds` (default 2,592,000s), and the
   * record is written BEFORE returning (Req 3.3, 10.3). The plaintext token is
   * returned exactly once alongside the persisted record.
   *
   * @param userId Owner of the new token.
   * @param options Optional rotation `familyId`; a new family id is generated
   *   when omitted.
   * @param trx Optional transaction so issuance can compose atomically with
   *   rotation (task 8.7).
   */
  issueRefreshToken(
    userId: string,
    options?: IssueRefreshTokenOptions,
    trx?: Knex.Transaction,
  ): Promise<IssuedRefreshToken>;

  /**
   * Rotate a presented refresh token (Req 4.1, 4.2, 4.4, 4.6).
   *
   * On a valid, unexpired, unrevoked token: the presented token is revoked and
   * replaced by a newly issued successor that shares its family id and links to
   * it (`replaced_by`), and a fresh access token is minted — returned as
   * `status: 'rotated'`. An unknown or expired token yields `status: 'invalid'`.
   * A token that exists but is already revoked is reuse: the whole family is
   * revoked and `status: 'reuse'` is returned (Req 4.6).
   *
   * All steps run inside a single transaction so the store never lands in a
   * half-rotated state (design.md "Refresh rotation"): the caller's `trx` is
   * used when provided, otherwise a new transaction is created from the shared
   * Knex instance.
   *
   * @param presentedToken The plaintext refresh token supplied by the client.
   * @param trx Optional transaction to compose within.
   */
  rotateRefreshToken(presentedToken: string, trx?: Knex.Transaction): Promise<RotateResult>;

  /**
   * Revoke a presented refresh token for logout (Req 5.1).
   *
   * Best-effort: if the token is found and still active it is revoked by id;
   * unknown or already-revoked tokens are a no-op (the auth service always
   * responds 200 regardless). Runs inside a transaction (the caller's `trx` when
   * provided, otherwise a new one from the shared Knex instance).
   *
   * @param presentedToken The plaintext refresh token supplied by the client.
   * @param trx Optional transaction to compose within.
   */
  revokeRefreshToken(presentedToken: string, trx?: Knex.Transaction): Promise<void>;
}

/**
 * The minimal refresh-tokens persistence surface the Token_Manager depends on.
 * Declaring only what is used keeps the manager unit-testable with a lightweight
 * mock. Structurally satisfied by the real {@link refreshTokensRepository}.
 */
export interface RefreshTokensRepo {
  insert: typeof refreshTokensRepository.insert;
  /** Look up a stored record by the one-way hash of a presented token. */
  findByHash: typeof refreshTokensRepository.findByHash;
  /** Revoke a single token by id, optionally linking it to its successor. */
  revokeById: typeof refreshTokensRepository.revokeById;
  /** Revoke every token sharing a family id (reuse detection, Req 4.6). */
  revokeFamily: typeof refreshTokensRepository.revokeFamily;
}

/**
 * The minimal users-persistence surface the Token_Manager needs to resolve an
 * account's current role during refresh rotation, so the rotated access token
 * carries the owner's role claim (Req 2.1). Declaring only `findById` keeps the
 * manager unit-testable with a lightweight mock; structurally satisfied by the
 * real {@link usersRepository}.
 */
export interface TokenManagerUsersRepo {
  findById(id: string, trx?: Knex.Transaction): Promise<{ role: Role } | null>;
}

/** Dependencies for {@link createTokenManager}. */
export interface TokenManagerDeps {
  /** HMAC signing key (Req 10.1). */
  signingKey: string;
  /** Access-token lifetime in seconds. Defaults to {@link ACCESS_TOKEN_TTL_SECONDS}. */
  accessTtlSeconds?: number;
  /** Refresh-token lifetime in seconds. Defaults to {@link REFRESH_TOKEN_TTL_SECONDS} (Req 3.3). */
  refreshTtlSeconds?: number;
  /**
   * Refresh-tokens persistence dependency. Defaults to the real
   * {@link refreshTokensRepository}; injectable so issuance is unit-testable
   * with a mock and no datastore.
   */
  refreshTokensRepo?: RefreshTokensRepo;
  /**
   * Users persistence used during refresh rotation to look up the owner's
   * current role so the rotated access token carries the correct `role` claim
   * (Req 2.1). Optional: when omitted, rotation falls back to the default role
   * `'user'`. {@link getDefaultTokenManager} injects the real
   * {@link usersRepository}.
   */
  usersRepo?: TokenManagerUsersRepo;
  /** Clock source in epoch milliseconds. Defaults to {@link Date.now}. Injectable for tests. */
  now?: () => number;
}

/**
 * Create a Token_Manager bound to the given signing key and (optional) TTL and
 * clock. Keeping the signing key injectable makes the manager unit-testable
 * without touching the environment.
 */
export function createTokenManager(deps: TokenManagerDeps): TokenManager {
  const { signingKey } = deps;
  const accessTtlSeconds = deps.accessTtlSeconds ?? ACCESS_TOKEN_TTL_SECONDS;
  const refreshTtlSeconds = deps.refreshTtlSeconds ?? REFRESH_TOKEN_TTL_SECONDS;
  const refreshTokensRepo = deps.refreshTokensRepo ?? refreshTokensRepository;
  const usersRepo = deps.usersRepo;
  const now = deps.now ?? Date.now;

  function issueAccessToken(userId: string, role: Role = 'user'): string {
    // Compute iat/exp from the injected clock so the invariant exp - iat === TTL
    // holds deterministically and is testable (Property 8). We set the claims
    // explicitly (rather than via `expiresIn`) to honor the injected `now`.
    const iat = Math.floor(now() / 1000);
    const exp = iat + accessTtlSeconds;
    // Embed exactly one `role` claim alongside sub/iat/exp (Req 2.1); an
    // unspecified role defaults to `'user'` via the parameter default (Req 2.2).
    return jwt.sign({ sub: userId, role, iat, exp }, signingKey, {
      algorithm: ACCESS_TOKEN_ALGORITHM,
    });
  }

  function verifyAccessToken(token: string | undefined): AccessTokenVerification {
    // A missing/empty token is authentication-required, not a parse failure (Req 6.2).
    if (token === undefined || token.trim().length === 0) {
      return { status: 'missing' };
    }

    try {
      const decoded = jwt.verify(token, signingKey, {
        algorithms: [ACCESS_TOKEN_ALGORITHM],
        // Verify expiry against the injected clock (in seconds) for testability.
        clockTimestamp: Math.floor(now() / 1000),
      });

      // A token signed by us always carries a string `sub`; anything else is
      // treated as invalid rather than accepted.
      if (typeof decoded === 'object' && decoded !== null && typeof decoded.sub === 'string') {
        // Surface the account role to the authorization middleware, normalizing
        // an absent or out-of-set `role` claim to `'user'` (Req 2.2, 2.5).
        return {
          status: 'accepted',
          userId: decoded.sub,
          role: normalizeRole((decoded as { role?: unknown }).role),
        };
      }
      return { status: 'invalid' };
    } catch (error) {
      // Expired tokens (TokenExpiredError extends JsonWebTokenError) → expired (Req 6.4).
      if (error instanceof jwt.TokenExpiredError) {
        return { status: 'expired' };
      }
      if (error instanceof jwt.JsonWebTokenError) {
        // Unparseable tokens → malformed (Req 6.5); signature/other failures → invalid (Req 6.3).
        return MALFORMED_MESSAGES.has(error.message)
          ? { status: 'malformed' }
          : { status: 'invalid' };
      }
      // Any unexpected error is treated conservatively as an invalid token; this
      // method never throws for verification failures.
      return { status: 'invalid' };
    }
  }

  async function issueRefreshToken(
    userId: string,
    options?: IssueRefreshTokenOptions,
    trx?: Knex.Transaction,
  ): Promise<IssuedRefreshToken> {
    // High-entropy opaque token from a CSPRNG (base64url is URL-safe and
    // compact). This plaintext is returned to the caller once and never stored.
    const token = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');

    // Persist only the one-way hash of the token (Req 10.3).
    const tokenHash = hashRefreshToken(token);

    // Absolute expiry from the injected clock so it is deterministic/testable
    // (Req 3.3: expires_at = created_at + refreshTtlSeconds).
    const expiresAt = new Date(now() + refreshTtlSeconds * 1000);

    // Reuse the caller's rotation lineage when provided (task 8.7), otherwise
    // start a fresh family for a brand-new session.
    const familyId = options?.familyId ?? crypto.randomUUID();

    // Persist BEFORE returning so the record provably exists in the datastore
    // by the time the caller receives the plaintext (Req 3.3).
    const record = await refreshTokensRepo.insert(
      { userId, familyId, tokenHash, expiresAt },
      trx,
    );

    return { token, record };
  }

  /**
   * Core rotation logic, always executed against an active transaction so the
   * revoke-old + insert-new (or family revoke) pair is atomic.
   */
  async function rotateWithin(
    presentedToken: string,
    tx: Knex.Transaction,
  ): Promise<RotateResult> {
    // 1. Hash the presented token and look it up (single unique-indexed read).
    const tokenHash = hashRefreshToken(presentedToken);
    const record = await refreshTokensRepo.findByHash(tokenHash, tx);

    // 2. Unknown token → invalid (Req 4.4).
    if (record === null) {
      return { status: 'invalid' };
    }

    // 3. Expired token → invalid, regardless of revoked state (Req 4.4). Expiry
    //    is checked against the injected clock for consistency with issuance.
    if (record.expiresAt.getTime() <= now()) {
      return { status: 'invalid' };
    }

    // 4. Already-revoked (previously rotated) token → reuse: revoke the whole
    //    family so the currently-live successor is invalidated too (Req 4.6).
    if (record.revoked) {
      await refreshTokensRepo.revokeFamily(record.familyId, tx);
      return { status: 'reuse', userId: record.userId };
    }

    // 5. Active token → issue a successor sharing the family id, then revoke the
    //    presented token linking it to that successor (Req 4.1, 4.2).
    const successor = await issueRefreshToken(
      record.userId,
      { familyId: record.familyId },
      tx,
    );
    await refreshTokensRepo.revokeById(record.id, { replacedBy: successor.record.id }, tx);

    // Resolve the owner's current role so the rotated access token carries the
    // correct `role` claim (Req 2.1). When no users repo is wired, fall back to
    // the default role `'user'`.
    const owner = usersRepo ? await usersRepo.findById(record.userId, tx) : null;
    const role: Role = owner ? owner.role : 'user';
    const accessToken = issueAccessToken(record.userId, role);

    return {
      status: 'rotated',
      userId: record.userId,
      accessToken,
      refreshToken: successor.token,
      record: successor.record,
    };
  }

  async function rotateRefreshToken(
    presentedToken: string,
    trx?: Knex.Transaction,
  ): Promise<RotateResult> {
    // Prefer the caller's transaction; otherwise open one on the shared Knex
    // instance so the rotation steps commit or roll back together.
    if (trx !== undefined) {
      return rotateWithin(presentedToken, trx);
    }
    return sharedKnex.transaction((tx) => rotateWithin(presentedToken, tx));
  }

  /**
   * Revoke logic executed against an active transaction. Best-effort: only an
   * active (found, not revoked) token is revoked; anything else is a no-op.
   */
  async function revokeWithin(
    presentedToken: string,
    tx: Knex.Transaction,
  ): Promise<void> {
    const tokenHash = hashRefreshToken(presentedToken);
    const record = await refreshTokensRepo.findByHash(tokenHash, tx);

    // Logout is best-effort: unknown or already-revoked tokens require no work
    // (the auth service always responds 200; Req 5.1).
    if (record === null || record.revoked) {
      return;
    }

    await refreshTokensRepo.revokeById(record.id, undefined, tx);
  }

  async function revokeRefreshToken(
    presentedToken: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    if (trx !== undefined) {
      await revokeWithin(presentedToken, trx);
      return;
    }
    await sharedKnex.transaction((tx) => revokeWithin(presentedToken, tx));
  }

  return {
    issueAccessToken,
    verifyAccessToken,
    issueRefreshToken,
    rotateRefreshToken,
    revokeRefreshToken,
  };
}

let defaultTokenManager: TokenManager | undefined;

/**
 * Lazily build (and memoize) a Token_Manager from {@link loadConfig}.
 *
 * Building lazily — rather than at module import — avoids throwing a
 * {@link ConfigError} in contexts that legitimately have no signing key (such as
 * pure-logic unit tests that use {@link createTokenManager} directly).
 */
export function getDefaultTokenManager(): TokenManager {
  if (defaultTokenManager === undefined) {
    const config = loadConfig();
    defaultTokenManager = createTokenManager({
      signingKey: config.jwtSigningKey,
      accessTtlSeconds: config.constants.accessTokenTtlSeconds,
      refreshTtlSeconds: config.constants.refreshTokenTtlSeconds,
      refreshTokensRepo: refreshTokensRepository,
      usersRepo: usersRepository,
    });
  }
  return defaultTokenManager;
}

export default createTokenManager;
