// Feature: user-registration-backend, Property 18: Profile round-trip returns the caller's own account
/**
 * Property-based test for the profile round-trip of `GET /me`.
 *
 * Design reference: `design.md` -> "Property 18: Profile round-trip returns the
 * caller's own account". For any account that exists in the datastore, an
 * authenticated request whose auth guard resolves to that account's id must
 * receive that same account back — exactly `{ id, email }`, the caller's own
 * account and nothing else (Req 7.1) — with the password hash never present in
 * the response body (Req 7.2, exercised here as a guard on the round-trip).
 *
 * No database is used. The test builds a tiny Express app that:
 *   1. parses JSON;
 *   2. runs a stub auth middleware that sets `req.userId` to a per-request value
 *      (updated via a closure variable before each supertest call), standing in
 *      for the real auth guard from task 14.7;
 *   3. mounts `GET /me` -> `createMeController(mockUsersRepo)`; and
 *   4. mounts the real centralized error handler.
 * The mock users repository is backed by an in-memory `Map<id, UserRecord>`.
 *
 * Each property run performs one real HTTP round-trip, so `numRuns` is kept
 * modest (~50).
 *
 * Validates: Requirements 7.1
 */
import fc from 'fast-check';
import express, { type Express } from 'express';
import request from 'supertest';

import { createMeController, type MeUsersRepository } from './meController';
import { createErrorHandler } from '../middleware/errorHandler';
import type { UserRecord } from '../repositories/usersRepository';
// Importing the auth guard pulls in the `Express.Request.userId` type
// augmentation used by the stub middleware below.
import '../middleware/authGuard';

/**
 * Build the test app around a shared, mutable seed store and a `currentUserId`
 * cell. The stub guard reads `currentUserId` at request time, so tests set it
 * immediately before issuing each request.
 */
function buildApp(store: Map<string, UserRecord>): {
  app: Express;
  setCurrentUserId: (id: string | undefined) => void;
} {
  let currentUserId: string | undefined;

  const mockUsersRepo: MeUsersRepository = {
    findById(id: string): Promise<UserRecord | null> {
      return Promise.resolve(store.get(id) ?? null);
    },
  };

  const app = express();
  app.use(express.json());
  // Stub auth guard: attaches the per-request authenticated id (Req 6.1 stand-in).
  app.use((req, _res, next) => {
    req.userId = currentUserId;
    next();
  });
  app.get('/me', createMeController(mockUsersRepo));
  app.use(createErrorHandler());

  return {
    app,
    setCurrentUserId: (id) => {
      currentUserId = id;
    },
  };
}

describe('Property 18: Profile round-trip returns the caller\'s own account', () => {
  it('returns exactly the caller\'s own { id, email } with no password hash', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          id: fc.uuid(),
          email: fc
            .tuple(
              fc.stringMatching(/^[a-z0-9]{1,12}$/),
              fc.stringMatching(/^[a-z0-9]{1,8}$/),
              fc.constantFrom('com', 'org', 'net', 'io'),
            )
            .map(([local, domain, tld]) => `${local}@${domain}.${tld}`),
        }),
        async ({ id, email }) => {
          const store = new Map<string, UserRecord>();
          const { app, setCurrentUserId } = buildApp(store);

          // Seed the repository with the full record (incl. a password hash that
          // must never surface in the response).
          store.set(id, {
            id,
            email,
            passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$seedsalt$seedhash',
            role: 'user',
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
          });

          // The guard resolves this request to the seeded account.
          setCurrentUserId(id);

          const res = await request(app).get('/me');

          // 200 with the caller's own account, exactly { id, email } (Req 7.1).
          expect(res.status).toBe(200);
          expect(res.body).toEqual({ id, email });
          // The password hash never appears anywhere in the body.
          expect(res.body).not.toHaveProperty('passwordHash');
          expect(JSON.stringify(res.body)).not.toContain('argon2');
        },
      ),
      { numRuns: 50 },
    );
  });
});
