// Feature: user-registration-backend, Property 24: HTTPS is enforced in non-local environments
/**
 * Property-based test for HTTPS enforcement.
 *
 * Design reference: `design.md` -> "Property 24: HTTPS is enforced in
 * non-local environments" and Requirement 10.4. This test drives
 * {@link createHttpsEnforcement} through a tiny Express app that mounts the
 * middleware ahead of a `/ping` handler, then issues real HTTP requests with
 * supertest whose `x-forwarded-proto` header marks the request as secure
 * (`https`) or insecure (`http`).
 *
 * From the generated `httpsRequired` flag and `secure` flag we know the exact
 * expected outcome and assert:
 *
 *  - `httpsRequired === false` -> always `200` (pass-through regardless of proto);
 *  - `httpsRequired === true` and secure -> `200`;
 *  - `httpsRequired === true` and NOT secure -> `403` with an ErrorBody whose
 *    `error.code === 'https_required'`, and the `/ping` handler did NOT run
 *    (the body is the error, not `{ ok: true }`).
 *
 * The global fast-check config (see `src/test/setup.ts`) runs a minimum of 100
 * iterations; `numRuns` is capped here since each case spins a live request.
 *
 * Validates: Requirements 10.4
 */
import express, { type Express } from 'express';
import request from 'supertest';
import fc from 'fast-check';
import { createHttpsEnforcement } from './httpsEnforcement';

/**
 * Build a minimal Express app that trusts the proxy, applies HTTPS enforcement
 * with the given flag, and exposes a `/ping` handler that responds only if the
 * middleware lets the request through.
 */
function buildApp(httpsRequired: boolean): Express {
  const app = express();
  app.set('trust proxy', true);
  app.use(createHttpsEnforcement({ httpsRequired }));
  app.get('/ping', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe('createHttpsEnforcement - Property 24: HTTPS is enforced in non-local environments', () => {
  it('enforces HTTPS only when required, and rejects insecure requests before the handler (Req 10.4)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.boolean(), async (httpsRequired, secure) => {
        const app = buildApp(httpsRequired);
        const proto = secure ? 'https' : 'http';

        const response = await request(app)
          .get('/ping')
          .set('x-forwarded-proto', proto);

        if (!httpsRequired) {
          // Enforcement disabled: always passes through regardless of proto.
          expect(response.status).toBe(200);
          expect(response.body).toEqual({ ok: true });
          return;
        }

        if (secure) {
          // Enforcement on + secure transport: request proceeds.
          expect(response.status).toBe(200);
          expect(response.body).toEqual({ ok: true });
          return;
        }

        // Enforcement on + insecure transport: rejected before the handler.
        expect(response.status).toBe(403);
        expect(response.body?.error?.code).toBe('https_required');
        // The /ping handler must NOT have run.
        expect(response.body).not.toEqual({ ok: true });
      }),
      { numRuns: 50 },
    );
  });
});
