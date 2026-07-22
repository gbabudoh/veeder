// Feature: user-registration-backend, Property 14: Reuse of a rotated refresh token revokes the entire family
/**
 * Property-based test for reuse-triggered family revocation.
 *
 * Design reference: `design.md` -> "Property 14: Reuse of a rotated refresh
 * token revokes the entire family". This test drives
 * {@link createTokenManager}'s `rotateRefreshToken` and asserts that
 * re-presenting an already-rotated (revoked) refresh token is detected as reuse
 * and revokes EVERY token in that token's rotation family — including the
 * currently-live successor — while issuing no new successor on the reuse path
 * (Req 4.6).
 *
 * No datastore is involved: a stateful, Map-backed in-memory fake
 * {@link RefreshTokensRepo} mirrors the real repository's mutation semantics
 * (`insert` seeds a record, `revokeById` flips a single record, `revokeFamily`
 * flips every record sharing a family id). A dummy transaction (`{} as any`) is
 * threaded through so the manager runs `rotateWithin` against the injected repo
 * directly rather than opening a real Knex transaction.
 *
 * For any user id (and any number of intermediate rotations) we:
 *   1. issue an initial refresh token R0, seeding a fresh family F;
 *   2. rotate R0 once -> `rotated`, producing successor R1 in family F, with R0
 *      now revoked;
 *   3. optionally chain further rotations (R1 -> R2 -> ...), each `rotated`;
 *   4. re-present the ORIGINAL R0 plaintext (now revoked) and assert:
 *        - status === 'reuse' with the owning userId;
 *        - every record in family F is revoked (family-wide revocation),
 *          including the live successor R1 (R1.revoked === true);
 *        - no new successor was issued on the reuse path (family F record count
 *          is unchanged across the reuse call).
 *
 * The global fast-check config (see `src/test/setup.ts`) runs a minimum of 100
 * iterations per property.
 *
 * Validates: Requirements 4.6
 */
import crypto from 'node:crypto';

import fc from 'fast-check';

import { createTokenManager, type RefreshTokensRepo } from './tokenManager';
import type {
  InsertRefreshTokenInput,
  RefreshTokenRecord,
  RevokeByIdOptions,
} from '../repositories/refreshTokensRepository';

/**
 * A stateful, Map-backed fake refresh-tokens repository that mirrors the real
 * repository's mutation semantics. Records live in an id-keyed map; lookups by
 * hash return a snapshot copy (as a real datastore read would), while
 * revocation mutates the stored records in place.
 */
function createStatefulFakeRepo(): {
  repo: RefreshTokensRepo;
  store: Map<string, RefreshTokenRecord>;
  countFamily: (familyId: string) => number;
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
      // Return a snapshot copy so callers cannot mutate the stored row directly.
      return { ...record };
    },

    async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
      for (const record of store.values()) {
        if (record.tokenHash === tokenHash) {
          // Snapshot copy reflects the record's state at read time.
          return { ...record };
        }
      }
      return null;
    },

    async revokeById(id: string, options?: RevokeByIdOptions): Promise<void> {
      const record = store.get(id);
      if (record !== undefined) {
        record.revoked = true;
        if (options?.replacedBy !== undefined) {
          record.replacedBy = options.replacedBy;
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

  const countFamily = (familyId: string): number => {
    let count = 0;
    for (const record of store.values()) {
      if (record.familyId === familyId) {
        count += 1;
      }
    }
    return count;
  };

  return { repo, store, countFamily };
}

describe('tokenManager.rotateRefreshToken - Property 14: reuse revokes the whole family', () => {
  it('re-presenting a rotated token revokes every token in its family and issues no successor (Req 4.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        // Optionally chain extra rotations (R1 -> R2 -> ...) before reusing R0.
        fc.nat({ max: 3 }),
        async (userId, extraRotations) => {
          const { repo, store, countFamily } = createStatefulFakeRepo();
          const tokenManager = createTokenManager({
            signingKey: 'test-signing-key-at-least-32-chars-long',
            refreshTokensRepo: repo,
          });
          // A dummy transaction routes rotation through the injected repo directly.
          const trx = {} as never;

          // (1) Issue the initial refresh token R0, seeding family F.
          const initial = await tokenManager.issueRefreshToken(userId);
          const originalToken = initial.token; // R0 plaintext
          const familyId = initial.record.familyId; // F

          // (2) Rotate R0 once -> `rotated`, producing successor R1 in family F.
          const firstRotation = await tokenManager.rotateRefreshToken(
            originalToken,
            trx,
          );
          expect(firstRotation.status).toBe('rotated');
          if (firstRotation.status !== 'rotated') {
            throw new Error('expected first rotation to succeed');
          }
          const r1Id = firstRotation.record.id;
          expect(firstRotation.record.familyId).toBe(familyId);
          // R0 is now revoked in the store.
          const r0Id = initial.record.id;
          expect(store.get(r0Id)?.revoked).toBe(true);

          // (3) Optionally chain further rotations R1 -> R2 -> ... , each `rotated`.
          let liveToken = firstRotation.refreshToken;
          for (let i = 0; i < extraRotations; i += 1) {
            const next = await tokenManager.rotateRefreshToken(liveToken, trx);
            expect(next.status).toBe('rotated');
            if (next.status !== 'rotated') {
              throw new Error('expected chained rotation to succeed');
            }
            expect(next.record.familyId).toBe(familyId);
            liveToken = next.refreshToken;
          }

          // (4) Re-present the ORIGINAL R0 plaintext (now revoked) -> reuse.
          const familyCountBeforeReuse = countFamily(familyId);
          const reuse = await tokenManager.rotateRefreshToken(originalToken, trx);

          // status === 'reuse' with the owning userId.
          expect(reuse.status).toBe('reuse');
          if (reuse.status !== 'reuse') {
            throw new Error('expected reuse detection');
          }
          expect(reuse.userId).toBe(userId);

          // Every record in family F is now revoked (family-wide revocation).
          for (const record of store.values()) {
            if (record.familyId === familyId) {
              expect(record.revoked).toBe(true);
            }
          }
          // The currently-live successor R1 is revoked too.
          expect(store.get(r1Id)?.revoked).toBe(true);

          // No new successor was issued on the reuse path: family F record count
          // is unchanged across the reuse call (only revocation flags changed).
          expect(countFamily(familyId)).toBe(familyCountBeforeReuse);
        },
      ),
    );
  });
});
