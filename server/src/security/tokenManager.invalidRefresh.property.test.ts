// Feature: user-registration-backend, Property 13: Invalid refresh tokens are rejected
/**
 * Property-based test for rejection of invalid refresh tokens at rotation.
 *
 * Design reference: `design.md` -> "Property 13: Invalid refresh tokens are
 * rejected". For any refresh token that is absent from the datastore or expired,
 * rotation must yield `status: 'invalid'` (which the refresh controller maps to
 * `401`) and MUST NOT issue a successor — no new record is inserted into the
 * store. The missing/empty `refreshToken` field (→ `400`) is handled by
 * `validateRefresh` at the controller, not by {@link TokenManager.rotateRefreshToken},
 * so it is out of scope here.
 *
 * No real database is used: a stateful, Map-backed in-memory fake repo is
 * injected via {@link createTokenManager}, and a dummy transaction (`{} as any`)
 * is passed to `rotateRefreshToken` so the injected repo is used directly
 * without opening a real Knex transaction.
 *
 * Two invalid cases are covered:
 *   1. Never-issued token: a random string that was never inserted → the store
 *      is unknown, so rotation returns `invalid` and the store size is unchanged
 *      (no successor inserted) (Req 4.4).
 *   2. Expired token: a token is issued with a short TTL by a manager clocked at
 *      T0, then a second manager sharing the SAME fake repo is clocked well past
 *      that expiry; rotating the (now-expired) token returns `invalid` and no
 *      successor is inserted (Req 4.4).
 *
 * In all invalid cases the result carries no `accessToken`/`refreshToken`
 * fields — only `status: 'invalid'`.
 *
 * The global fast-check config (see `src/test/setup.ts`) runs a minimum of 100
 * iterations per property; `numRuns: 100` is set explicitly as well.
 *
 * Validates: Requirements 4.4, 4.5
 */
import crypto from 'node:crypto';

import fc from 'fast-check';

import {
  createTokenManager,
  hashRefreshToken,
  type RefreshTokensRepo,
} from './tokenManager';
import type {
  InsertRefreshTokenInput,
  RefreshTokenRecord,
  RevokeByIdOptions,
} from '../repositories/refreshTokensRepository';

// A fixed, sufficiently-long signing key. No environment or datastore is needed:
// these properties exercise rotation against an in-memory repo only.
const SIGNING_KEY = 'x'.repeat(40);

// A dummy transaction: passing a defined `trx` makes rotateRefreshToken use the
// injected repo directly instead of opening a real Knex transaction.
const DUMMY_TRX = {} as never;

/**
 * A stateful, Map-backed fake of the RefreshTokens_Repository (mirrors the
 * fake used by the rotation property test, task 8.8). It supports the full
 * surface rotation touches — insert / findByHash / revokeById / revokeFamily —
 * keyed by token hash for O(1) lookup.
 */
function createFakeRepo(): { repo: RefreshTokensRepo; store: Map<string, RefreshTokenRecord> } {
  // Keyed by tokenHash so findByHash is a direct lookup.
  const store = new Map<string, RefreshTokenRecord>();

  const repo: RefreshTokensRepo = {
    async insert(input: InsertRefreshTokenInput): Promise<RefreshTokenRecord> {
      const record: RefreshTokenRecord = {
        id: crypto.randomUUID(),
        userId: input.userId,
        familyId: input.familyId,
        tokenHash: input.tokenHash,
        revoked: false,
        expiresAt: input.expiresAt,
        createdAt: new Date(),
        replacedBy: null,
      };
      store.set(record.tokenHash, record);
      return record;
    },
    async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
      return store.get(tokenHash) ?? null;
    },
    async revokeById(id: string, options?: RevokeByIdOptions): Promise<void> {
      for (const record of store.values()) {
        if (record.id === id) {
          record.revoked = true;
          if (options?.replacedBy !== undefined) {
            record.replacedBy = options.replacedBy;
          }
          return;
        }
      }
    },
    async revokeFamily(familyId: string): Promise<void> {
      for (const record of store.values()) {
        if (record.familyId === familyId) {
          record.revoked = true;
        }
      }
    },
  };

  return { repo, store };
}

/** Assert an invalid rotation result carries no issued tokens. */
function expectNoTokensIssued(result: Record<string, unknown>): void {
  expect(result.status).toBe('invalid');
  expect(result).not.toHaveProperty('accessToken');
  expect(result).not.toHaveProperty('refreshToken');
  expect((result as { accessToken?: unknown }).accessToken).toBeUndefined();
  expect((result as { refreshToken?: unknown }).refreshToken).toBeUndefined();
}

describe('createTokenManager.rotateRefreshToken - Property 13: invalid refresh tokens are rejected', () => {
  it('rejects never-issued tokens and expired tokens as invalid without issuing a successor (Req 4.4, 4.5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A random token that was never issued (never inserted into the store).
        fc.string({ minLength: 1 }),
        // Owner of the (later) issued-then-expired token.
        fc.string({ minLength: 1 }),
        // Issuance instant (epoch ms) for the expired-token case.
        fc.integer({ min: 0, max: 2 ** 40 }),
        // Short TTL in seconds for the token we will let expire.
        fc.integer({ min: 1, max: 60 }),
        // How far past expiry (in seconds, >= 1) the rotate clock is advanced.
        fc.integer({ min: 1, max: 100_000 }),
        async (unknownToken, userId, issueAtMs, ttlSeconds, secondsPastExpiry) => {
          const { repo, store } = createFakeRepo();

          // --- Case 1: never-issued token ---------------------------------
          // Ensure the random token is genuinely absent from the store.
          fc.pre(!store.has(hashRefreshToken(unknownToken)));

          const rotateManager = createTokenManager({
            signingKey: SIGNING_KEY,
            refreshTokensRepo: repo,
            // Clock well beyond any issuance so an issued token is also expired.
            now: () => issueAtMs + (ttlSeconds + secondsPastExpiry) * 1000,
          });

          const sizeBeforeUnknown = store.size;
          const unknownResult = await rotateManager.rotateRefreshToken(unknownToken, DUMMY_TRX);

          expectNoTokensIssued(unknownResult as Record<string, unknown>);
          // No successor inserted for an unknown token.
          expect(store.size).toBe(sizeBeforeUnknown);

          // --- Case 2: expired token --------------------------------------
          // Issue a token with a manager clocked at T0 and a short TTL, sharing
          // the SAME fake repo so the record is visible to the rotate manager.
          const issueManager = createTokenManager({
            signingKey: SIGNING_KEY,
            refreshTokensRepo: repo,
            refreshTtlSeconds: ttlSeconds,
            now: () => issueAtMs,
          });

          const { token: expiredToken, record } = await issueManager.issueRefreshToken(userId);
          // Sanity: at rotation time the record is strictly expired.
          expect(record.expiresAt.getTime()).toBeLessThanOrEqual(
            issueAtMs + (ttlSeconds + secondsPastExpiry) * 1000,
          );

          const sizeBeforeExpired = store.size;
          const expiredResult = await rotateManager.rotateRefreshToken(expiredToken, DUMMY_TRX);

          expectNoTokensIssued(expiredResult as Record<string, unknown>);
          // No successor inserted for an expired token.
          expect(store.size).toBe(sizeBeforeExpired);
        },
      ),
      { numRuns: 100 },
    );
  });
});
