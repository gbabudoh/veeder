// Feature: user-registration-backend, Property 9: Refresh token expiry is issuance + 2,592,000s and persisted before return
/**
 * Property-based test for refresh-token expiry math and persist-before-return.
 *
 * Design reference: `design.md` -> "Property 9: Refresh token expiry is
 * issuance + 2,592,000s and persisted before return". For any `userId`, any
 * issuance instant (injected via the `now` clock), and any refresh TTL (the
 * 2,592,000s contract default plus a spread of other reasonable TTLs), a freshly
 * issued refresh token must:
 *
 *  - persist a record whose `expiresAt.getTime() === now + refreshTtlSeconds * 1000`
 *    (Req 3.3), and
 *  - be persisted BEFORE `issueRefreshToken` returns — i.e. by the time the caller
 *    receives the plaintext, the record already exists in the datastore.
 *
 * No real database is used: an in-memory fake repo is injected via
 * {@link createTokenManager}. To prove persist-before-return, the fake's `insert`
 * is genuinely asynchronous (it awaits a resolved promise before recording the
 * row and pushing an `'inserted'` marker). Because `issueRefreshToken` awaits the
 * repo insert, once `await issueRefreshToken(...)` resolves the marker must be
 * present and the returned record must already live in the fake store.
 *
 * The `now` clock is injected as a closure over a generated epoch-millisecond
 * timestamp, so the expiry invariant holds deterministically without any
 * wall-clock dependency.
 *
 * The global fast-check config (see `src/test/setup.ts`) runs a minimum of 100
 * iterations per property.
 *
 * Validates: Requirements 3.3
 */
import crypto from 'node:crypto';

import fc from 'fast-check';

import { REFRESH_TOKEN_TTL_SECONDS } from '../config';
import type {
  InsertRefreshTokenInput,
  RefreshTokenRecord,
} from '../repositories/refreshTokensRepository';
import { createTokenManager, type RefreshTokensRepo } from './tokenManager';

// A fixed, sufficiently-long signing key. No environment or datastore needed:
// this property only exercises refresh-token issuance against an in-memory repo.
const SIGNING_KEY = 'x'.repeat(40);

/**
 * An in-memory fake of the RefreshTokens_Repository that records issuance ORDER.
 *
 * `insert` is intentionally asynchronous (awaits a resolved promise) so the test
 * can prove the token manager persists the record before returning: only after
 * the awaited insert completes are the row and the `'inserted'` marker recorded.
 * The other repo methods are not exercised by issuance and throw if called.
 */
function createFakeRepo(): {
  repo: RefreshTokensRepo;
  events: string[];
  store: Map<string, RefreshTokenRecord>;
} {
  const events: string[] = [];
  const store = new Map<string, RefreshTokenRecord>();

  const repo: RefreshTokensRepo = {
    insert: async (input: InsertRefreshTokenInput): Promise<RefreshTokenRecord> => {
      // Force a real async boundary so persist-before-return is meaningful.
      await Promise.resolve();

      const record: RefreshTokenRecord = {
        id: crypto.randomUUID(),
        userId: input.userId,
        familyId: input.familyId,
        tokenHash: input.tokenHash,
        revoked: false,
        // Echo back the caller-computed expiry exactly (Req 3.3).
        expiresAt: input.expiresAt,
        createdAt: new Date(),
        replacedBy: null,
      };

      store.set(record.id, record);
      // Record the persistence marker AFTER the row is stored.
      events.push('inserted');

      return record;
    },
    // Not used by issuance; guard against accidental invocation.
    findByHash: async () => {
      throw new Error('findByHash should not be called during issuance');
    },
    revokeById: async () => {
      throw new Error('revokeById should not be called during issuance');
    },
    revokeFamily: async () => {
      throw new Error('revokeFamily should not be called during issuance');
    },
  };

  return { repo, events, store };
}

// A spread of refresh TTLs including the contract default (2,592,000s; Req 3.3).
const ttlArb = fc.oneof(
  fc.constant(REFRESH_TOKEN_TTL_SECONDS),
  fc.integer({ min: 1, max: 31_536_000 }), // any reasonable positive TTL (up to ~1yr)
);

// Epoch milliseconds across a wide range (0 .. 2^40 ms ~= year 36812).
const nowMsArb = fc.integer({ min: 0, max: 2 ** 40 });

describe('createTokenManager.issueRefreshToken - Property 9: expiry is issuance + TTL, persisted before return', () => {
  it('persists a record with expiresAt === now + ttl*1000 that already exists once the call resolves (Req 3.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        nowMsArb,
        ttlArb,
        async (userId, nowMs, refreshTtlSeconds) => {
          const { repo, events, store } = createFakeRepo();

          const manager = createTokenManager({
            signingKey: SIGNING_KEY,
            refreshTtlSeconds,
            refreshTokensRepo: repo,
            // Inject a fixed clock via a closure over the generated timestamp.
            now: () => nowMs,
          });

          const { token, record } = await manager.issueRefreshToken(userId);

          // Persist-before-return: the awaited insert must have recorded its
          // marker and the returned record must already live in the store.
          expect(events).toContain('inserted');
          expect(store.has(record.id)).toBe(true);
          expect(store.get(record.id)).toBe(record);

          // Expiry invariant: absolute expiry is issuance + ttl (Req 3.3).
          expect(record.expiresAt.getTime()).toBe(nowMs + refreshTtlSeconds * 1000);

          // A plaintext token is returned to the caller exactly once.
          expect(typeof token).toBe('string');
          expect(token.length).toBeGreaterThan(0);
          expect(record.userId).toBe(userId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
