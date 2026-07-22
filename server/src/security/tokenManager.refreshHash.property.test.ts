// Feature: user-registration-backend, Property 23: Refresh tokens are persisted only as a one-way hash
/**
 * Property-based test for hash-only refresh-token persistence.
 *
 * Design reference: `design.md` -> "Property 23: Refresh tokens are persisted
 * only as a one-way hash". This test drives {@link createTokenManager}'s
 * `issueRefreshToken` for arbitrary user ids and asserts the plaintext token is
 * NEVER persisted — only its one-way SHA-256 hash reaches the repository
 * (Req 10.3).
 *
 * No datastore is involved: an in-memory fake {@link RefreshTokensRepo} records
 * every `insert` call so we can inspect exactly what would be persisted.
 *
 * For any user id we assert:
 *   1. the value handed to `repo.insert` as `tokenHash` equals
 *      `hashRefreshToken(returnedPlaintextToken)`;
 *   2. the plaintext token is never equal to the stored `tokenHash`;
 *   3. the stored `tokenHash` is a 64-char lowercase hex string (SHA-256); and
 *   4. no field on the recorded insert input equals the plaintext token.
 *
 * The global fast-check config (see `src/test/setup.ts`) runs a minimum of 100
 * iterations per property.
 *
 * Validates: Requirements 10.3
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
} from '../repositories/refreshTokensRepository';

/** SHA-256 hex is exactly 64 lowercase hex characters. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Build an in-memory fake refresh-tokens repository that records every insert
 * input and returns a plausible {@link RefreshTokenRecord} built solely from
 * that input (echoing the stored hash — never any plaintext).
 */
function createFakeRepo(): {
  repo: RefreshTokensRepo;
  insertCalls: InsertRefreshTokenInput[];
} {
  const insertCalls: InsertRefreshTokenInput[] = [];

  const repo: RefreshTokensRepo = {
    async insert(input: InsertRefreshTokenInput): Promise<RefreshTokenRecord> {
      insertCalls.push(input);
      return {
        id: crypto.randomUUID(),
        userId: input.userId,
        familyId: input.familyId,
        tokenHash: input.tokenHash,
        revoked: false,
        expiresAt: input.expiresAt,
        createdAt: new Date(),
        replacedBy: null,
      };
    },
    // Unused by issueRefreshToken; present to satisfy the repo surface.
    findByHash: async () => null,
    revokeById: async () => undefined,
    revokeFamily: async () => undefined,
  };

  return { repo, insertCalls };
}

describe('tokenManager.issueRefreshToken - Property 23: hash-only persistence', () => {
  it('persists only a one-way SHA-256 hash, never the plaintext token (Req 10.3)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (userId) => {
        const { repo, insertCalls } = createFakeRepo();
        const tokenManager = createTokenManager({
          signingKey: 'test-signing-key-at-least-32-chars-long',
          refreshTokensRepo: repo,
        });

        const { token } = await tokenManager.issueRefreshToken(userId);

        // Exactly one insert occurred for a single issuance.
        expect(insertCalls).toHaveLength(1);
        const input = insertCalls[0];

        // (1) The persisted hash is the one-way hash of the returned plaintext.
        expect(input.tokenHash).toBe(hashRefreshToken(token));

        // (2) The plaintext token is never equal to the stored hash.
        expect(token).not.toBe(input.tokenHash);

        // (3) The stored hash is a 64-char lowercase hex string (SHA-256).
        expect(input.tokenHash).toMatch(SHA256_HEX);

        // (4) No recorded insert field carries the plaintext token verbatim.
        for (const value of Object.values(input)) {
          expect(value).not.toBe(token);
        }
      }),
    );
  });
});
