// Feature: user-registration-backend, Property 19: Valid token for a deleted account returns 404
/**
 * Property 19: Valid token for a deleted account returns 404 —
 * Validates: Requirements 7.5
 *
 * When a request carries a VALID access token (the auth guard has already
 * accepted it and populated `req.userId`) but the referenced User_Account no
 * longer exists, `GET /me` must respond `404` with the machine-readable error
 * code `account_not_found` — and must never leak any user data (no `id`,
 * `email`, or `passwordHash`) in the body.
 *
 * The test exercises the real HTTP path end-to-end without a datastore: a tiny
 * Express app stubs the auth middleware to set `req.userId` to a generated uuid
 * (simulating an accepted access token), mounts {@link createMeController} with
 * an injected users repository whose `findById` always resolves `null`
 * (account deleted), and installs the centralized error handler so the thrown
 * {@link NotFoundError} is rendered as the wire-format 404.
 */
import express, { type Express } from 'express';
import request from 'supertest';
import fc from 'fast-check';

import { createMeController } from './meController';
import { createErrorHandler } from '../middleware/errorHandler';

/**
 * Build a minimal Express app for a given authenticated user id whose account
 * no longer exists. A stub auth middleware sets `req.userId` (as an accepted
 * access token would), then the controller resolves the (missing) account via
 * an injected repo whose `findById` always returns `null`.
 */
function buildApp(userId: string): Express {
  const app = express();
  app.use(express.json());

  // Stub auth middleware: simulate a VALID access token whose user was deleted.
  app.use((req, _res, next) => {
    req.userId = userId;
    next();
  });

  app.get('/me', createMeController({ findById: async () => null }));
  app.use(createErrorHandler());

  return app;
}

describe('meController - Property 19: Valid token for a deleted account returns 404 (Req 7.5)', () => {
  it('returns 404 account_not_found and leaks no user data when the account no longer exists', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (userId) => {
        const app = buildApp(userId);

        const response = await request(app).get('/me');

        // Valid token, account gone → 404 (Req 7.5).
        expect(response.status).toBe(404);

        // Structured error body carrying the stable machine-readable code.
        expect(response.body?.error?.code).toBe('account_not_found');

        // No user data leaks: no id / email / passwordHash anywhere in the body.
        const serialized = JSON.stringify(response.body);
        expect(response.body).not.toHaveProperty('id');
        expect(response.body).not.toHaveProperty('email');
        expect(response.body).not.toHaveProperty('passwordHash');
        expect(serialized.includes('passwordHash')).toBe(false);
        expect(serialized.includes(userId)).toBe(false);
      }),
      { numRuns: 50 },
    );
  });
});
