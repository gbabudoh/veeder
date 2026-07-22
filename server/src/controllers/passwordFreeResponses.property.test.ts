// Feature: user-registration-backend, Property 3: Hashed password is never present in responses
/**
 * Property 3: Hashed password is never present in responses.
 *
 * Design reference: `design.md` → "Correctness Properties" → Property 3.
 * **Validates: Requirements 1.6, 7.2**
 *
 * For any successful `POST /register` or `GET /me` response, the response body
 * contains no `password`, `passwordHash`, or `password_hash` field and never
 * echoes the plaintext password or the stored password hash.
 *
 * This test wires BOTH controllers into a tiny Express app with mocked
 * dependencies (no datastore):
 *
 *  - `POST /register` uses `createRegisterController(mockService)`, whose
 *    `register` returns only `{ id, email }`. The controller only echoes those
 *    two fields, so it must never introduce a hash.
 *  - `GET /me` runs behind a stub middleware that sets `req.userId`, then
 *    `createMeController(mockUsersRepo)` whose `findById` returns a FULL user
 *    record INCLUDING a `passwordHash`. This is the important case: even though
 *    the repository record carries a `passwordHash`, the response must exclude
 *    it (Req 7.2).
 *
 * The centralized error handler is mounted last so any thrown error still maps
 * to a well-formed response.
 */

import express, { type Express } from 'express';
import fc from 'fast-check';
import request from 'supertest';

import { createRegisterController } from './registerController';
import { createMeController, type MeUsersRepository } from './meController';
import { createErrorHandler } from '../middleware/errorHandler';
import type { RegistrationService } from '../services/registrationService';
import type { UserRecord } from '../repositories/usersRepository';

/**
 * Build a tiny Express app mounting both controllers with injected mocks.
 *
 * @param userId the id the stub auth middleware attaches to `req.userId`
 * @param userRecord the full record (including `passwordHash`) the mock users
 *   repository returns from `findById`
 */
function buildApp(userId: string, userRecord: UserRecord): Express {
  const app = express();
  app.use(express.json());

  // POST /register → controller echoes only { id, email } from the service.
  const mockService: RegistrationService = {
    register: async (body: unknown) => {
      // Derive a plausible id + normalized email from the request body; the
      // controller only reflects id + email and must never add a hash.
      const email =
        typeof (body as { email?: unknown }).email === 'string'
          ? ((body as { email: string }).email).trim().toLowerCase()
          : 'user@example.com';
      return { id: 'generated-id-123', email };
    },
  };
  app.post('/register', createRegisterController(mockService));

  // GET /me behind a stub auth middleware that sets req.userId, then a mock
  // users repo whose record INCLUDES a passwordHash.
  const mockUsersRepo: MeUsersRepository = {
    findById: async (id: string) => (id === userId ? userRecord : null),
  };
  app.get(
    '/me',
    (req, _res, next) => {
      req.userId = userId;
      next();
    },
    createMeController(mockUsersRepo),
  );

  app.use(createErrorHandler());
  return app;
}

/**
 * Assert a response body has exactly the keys `['email', 'id']` (sorted) and
 * that its serialized form contains none of the forbidden secret values or
 * secret-bearing keys.
 */
function assertNoSecrets(
  body: Record<string, unknown>,
  forbiddenValues: string[],
): void {
  // Exactly id + email (sorted for stable comparison).
  expect(Object.keys(body).sort()).toEqual(['email', 'id']);

  // No secret-bearing key present at the top level.
  expect(body).not.toHaveProperty('password');
  expect(body).not.toHaveProperty('passwordHash');
  expect(body).not.toHaveProperty('password_hash');

  // No secret-bearing key anywhere in the serialized JSON, and no secret value.
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain('passwordHash');
  expect(serialized).not.toContain('password_hash');
  for (const value of forbiddenValues) {
    if (value.length > 0) {
      expect(serialized).not.toContain(value);
    }
  }
}

describe('Property 3: Hashed password is never present in responses', () => {
  it('excludes password/hash from POST /register and GET /me responses (Req 1.6, 7.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Plausible email + password for the register request.
        fc
          .record({
            local: fc.stringMatching(/^[a-zA-Z0-9._%+-]{1,20}$/),
            domain: fc.stringMatching(/^[a-zA-Z0-9-]{1,15}$/),
            password: fc.string({ minLength: 8, maxLength: 128 }),
          })
          .map(({ local, domain, password }) => ({
            email: `${local}@${domain}.com`,
            password,
          })),
        // A userId and a realistic argon2id hash carried by the /me record.
        fc.uuid(),
        fc.string({ minLength: 16, maxLength: 64 }).map((s) => `$argon2id$v=19$m=65536,t=3,p=4$${s}`),
        async ({ email, password }, userId, passwordHash) => {
          const userRecord: UserRecord = {
            id: userId,
            email: email.trim().toLowerCase(),
            passwordHash,
            role: 'user',
            createdAt: new Date(),
          };

          const app = buildApp(userId, userRecord);

          // POST /register → 201, body has exactly { id, email }, no secrets.
          const registerRes = await request(app)
            .post('/register')
            .send({ email, password });
          expect(registerRes.status).toBe(201);
          assertNoSecrets(registerRes.body, [password, passwordHash]);

          // GET /me → 200, body has exactly { id, email }; the record's
          // passwordHash must NOT appear in the response (Req 7.2).
          const meRes = await request(app).get('/me');
          expect(meRes.status).toBe(200);
          assertNoSecrets(meRes.body, [password, passwordHash]);
        },
      ),
      { numRuns: 50 },
    );
  });
});
