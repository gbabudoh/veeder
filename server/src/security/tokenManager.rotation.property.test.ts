// Feature: user-registration-backend, Property 12: Refresh rotation revokes the old token and issues a valid successor
/**
 * Property-based test for refresh-token rotation.
 *
 * Design reference: `design.md` -> "Property 12: Refresh rotation revokes the
 * old token and issues a valid successor". For any `userId`, seeding a valid,
 * active refresh token and then rotating it must:
 *
 *  - return `status: 'rotated'` for that same `userId` (Req 4.1, 4.2);
 *  - revoke the PRESENTED token and link it to its successor via `replacedBy`
 *    (Req 4.2);
 *  - persist a successor that is unrevoked, not expired, and shares the
 *    predecessor's `familyId` (Req 4.2);
 *  - mint a fresh access token that `verifyAccessToken` accepts for `userId`
 *    (Req 4.1); and
 *  - return a new plaintext refresh token whose hash matches the successor
 *    record and which differs from the presented plaintext (Req 4.3).
 *
 * No real database is used: a STATEFUL in-memory fake {@link RefreshTokensRepo}
 * backed by a `Map<id, RefreshTokenRecord>` is injected via
 * {@link createTokenManager}, and a dummy transaction (`{} as any`) is passed to
 * `rotateRefreshToken` so the real shared-Knex transaction path is never taken —
 * rotation runs directly against the fake repo. All operations are pure crypto
 * (no argon2, no DB), so the property is fast.
 *
 * The global fast-check config (see `src/test/setup.ts`) runs a minimum of 100
 * iterations per property.
 *
 * Validates: Requirements 4.1, 4.2, 4.3
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

// A fixed, sufficiently-long signing key. No environment or datastore needed.
const SIGNING_KEY = 'test-signing-key-at-least-32-chars-long';

// The 30-day refresh TTL contract default (Req 3.3, 4.2).
const REFRESH_TTL_SECONDS = 2_592_000;

/**
 * Build a STATEFUL in-memory fake of the RefreshTokens_Repository backed by a
 * `Map<id, RefreshTokenRecord>`.
 *
 *  - `insert` creates a record (id via {@link crypto.randomUUID}, `revoked:false`,
 *    `replacedBy:null`) and stores it.
 *  - `findByHash` returns the record whose `tokenHash` matches, else `null`.
 *  - `revokeById` sets `revoked:true` and `replacedBy = opts?.replacedBy`.
 *  - `revokeFamily` sets `revoked:true` for every record with that `familyId`.
 *
 * The `trx` argument is accepted and ignored (the fake is the source of truth).
 */
function createFakeRepo(): {
  repo: RefreshTokensRepo;
  store: Map<string, RefreshTokenRecord>;
} {
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
      store.set(record.id, record);
      return record;
    },
    async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
      for (const record of store.values()) {
        if (record.tokenHash === tokenHash) {
          return record;
        }
      }
      return null;
    },
    async revokeById(id: string, options?: RevokeByIdOptions): Promise<void> {
      const record = store.get(id);
      if (record) {
        record.revoked = true;
        record.replacedBy = options?.replacedBy ?? null;
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

describe('tokenManager.rotateRefreshToken - Property 12: rotation revokes the old token and issues a valid successor', () => {
  it('rotates a valid active token: old revoked+linked, successor valid and same family, new access + refresh returned (Req 4.1, 4.2, 4.3)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (userId) => {
        const { repo, store } = createFakeRepo();
        const nowMs = Date.now();

        const tokenManager = createTokenManager({
          signingKey: SIGNING_KEY,
          refreshTtlSeconds: REFRESH_TTL_SECONDS,
          refreshTokensRepo: repo,
          now: () => nowMs,
        });

        // Seed a valid, active refresh token + record for this user.
        const seeded = await tokenManager.issueRefreshToken(userId);
        const oldPlaintext = seeded.token;
        const oldRecord = seeded.record;

        // Sanity: the seeded record is active before rotation.
        expect(store.get(oldRecord.id)?.revoked).toBe(false);

        // Rotate, passing a DUMMY transaction so the real knex path is bypassed.
        const result = await tokenManager.rotateRefreshToken(
          oldPlaintext,
          {} as never,
        );

        // (1) Rotation succeeded for this user.
        expect(result.status).toBe('rotated');
        if (result.status !== 'rotated') {
          return; // narrows the union for the remaining assertions
        }
        expect(result.userId).toBe(userId);

        // (2) The OLD record is now revoked and linked to the successor.
        const storedOld = store.get(oldRecord.id);
        expect(storedOld?.revoked).toBe(true);
        expect(storedOld?.replacedBy).toBe(result.record.id);

        // (3) The NEW record exists, is not revoked, shares the family id, and
        //     is not expired.
        const storedNew = store.get(result.record.id);
        expect(storedNew).toBeDefined();
        expect(storedNew?.revoked).toBe(false);
        expect(storedNew?.familyId).toBe(oldRecord.familyId);
        expect(storedNew?.id).not.toBe(oldRecord.id);
        expect(storedNew?.expiresAt.getTime()).toBeGreaterThan(nowMs);

        // (4) A fresh access token is returned and verifies to this user.
        const verification = tokenManager.verifyAccessToken(result.accessToken);
        expect(verification.status).toBe('accepted');
        if (verification.status === 'accepted') {
          expect(verification.userId).toBe(userId);
        }

        // (5) The returned refresh token is new: its hash matches the successor
        //     record and it differs from the presented plaintext.
        expect(hashRefreshToken(result.refreshToken)).toBe(
          result.record.tokenHash,
        );
        expect(result.refreshToken).not.toBe(oldPlaintext);
      }),
      { numRuns: 100 },
    );
  });
});
