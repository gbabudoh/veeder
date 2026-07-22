// Feature: user-registration-backend, Property 16: A revoked refresh token cannot be refreshed
/**
 * Property-based test for revoked-token refusal on refresh.
 *
 * Design reference: `design.md` -> "Property 16: A revoked refresh token cannot
 * be refreshed". This models the logout -> refresh sequence: for any `userId`,
 * issuing a refresh token, revoking it via `revokeRefreshToken` (as logout
 * does), and then attempting to `rotateRefreshToken` the now-revoked token must
 * NEVER mint new tokens. Because the record still exists but is flagged
 * `revoked`, rotation classifies it as reuse (`status: 'reuse'`) and revokes the
 * family — it is never `'rotated'`, so no usable successor access/refresh token
 * is ever produced (Req 5.4). Re-presenting the same revoked token a second time
 * likewise never rotates.
 *
 * No datastore is involved: a stateful, Map-backed in-memory fake
 * {@link RefreshTokensRepo} mirrors the real repository's mutation semantics
 * (`insert` seeds a record, `findByHash` reads by hash, `revokeById` flips a
 * single record, `revokeFamily` flips every record sharing a family id). A dummy
 * transaction (`{} as never`) is threaded through both `revokeRefreshToken` and
 * `rotateRefreshToken` so the manager runs against the injected repo directly
 * rather than opening a real Knex transaction.
 *
 * The global fast-check config (see `src/test/setup.ts`) runs a minimum of 100
 * iterations per property.
 *
 * Validates: Requirements 5.4
 */
import crypto from 'node:crypto';

import fc from 'fast-check';

import { createTokenManager, type RefreshTokensRepo } from './tokenManager';
import type {
  InsertRefreshTokenInput,
  RefreshTokenRecord,
  RevokeByIdOptions,
} from '../repositories/refreshTokensRepository';

// A fixed, sufficiently-long signing key. No environment or datastore needed.
const SIGNING_KEY = 'test-signing-key-at-least-32-chars-long';

/**
 * A stateful, Map-backed fake refresh-tokens repository that mirrors the real
 * repository's mutation semantics. Records live in an id-keyed map; lookups by
 * hash return a snapshot copy (as a real datastore read would), while
 * revocation mutates the stored records in place. The `trx` argument is
 * accepted and ignored — the fake is the source of truth.
 */
function createStatefulFakeRepo(): {
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
      return { ...record };
    },

    async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
      for (const record of store.values()) {
        if (record.tokenHash === tokenHash) {
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

  return { repo, store };
}

describe('tokenManager - Property 16: a revoked refresh token cannot be refreshed', () => {
  it('rotating a token revoked via logout never rotates and issues no usable successor (Req 5.4)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (userId) => {
        const { repo, store } = createStatefulFakeRepo();
        const tokenManager = createTokenManager({
          signingKey: SIGNING_KEY,
          refreshTokensRepo: repo,
        });
        // A dummy transaction routes both operations through the injected repo.
        const trx = {} as never;

        // (1) Issue a refresh token, seeding an active record for this user.
        const issued = await tokenManager.issueRefreshToken(userId);
        const token = issued.token;
        expect(store.get(issued.record.id)?.revoked).toBe(false);

        // (2) Revoke it via revokeRefreshToken (models logout).
        await tokenManager.revokeRefreshToken(token, trx);
        expect(store.get(issued.record.id)?.revoked).toBe(true);

        // (3) Attempt to refresh the revoked token: it must NOT rotate. The
        //     record still exists but is revoked, so this is detected as reuse.
        const first = await tokenManager.rotateRefreshToken(token, trx);
        expect(first.status).not.toBe('rotated');
        expect(first.status).toBe('reuse');

        // No usable successor token was produced (a 'reuse'/'invalid' result
        // carries neither an accessToken nor a refreshToken field).
        expect(
          (first as { accessToken?: string }).accessToken,
        ).toBeUndefined();
        expect(
          (first as { refreshToken?: string }).refreshToken,
        ).toBeUndefined();

        // (4) Re-presenting the same revoked token still never rotates.
        const second = await tokenManager.rotateRefreshToken(token, trx);
        expect(second.status).not.toBe('rotated');
        expect(
          (second as { refreshToken?: string }).refreshToken,
        ).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
