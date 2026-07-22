// Feature: user-registration-backend, Property 20: Rate limiting enforces the per-endpoint boundary
/**
 * Property-based test for per-endpoint rate-limit boundaries.
 *
 * Design reference: `design.md` -> "Property 20: Rate limiting enforces the
 * per-endpoint boundary". For an endpoint with limit `L` and a sequence of
 * requests from a single source IP within one 60-second window:
 *
 *   1. the first `L` requests reach the downstream handler and return `200`
 *      (Req 8.1 login / 8.3 registration boundary — within the limit); and
 *   2. the (L+1)th request returns `429` with an integer `Retry-After` header
 *      in `[1, 60]`, a body of the shared `ErrorBody` shape with
 *      `error.code === 'rate_limited'`, and is NOT processed as an
 *      authentication/registration attempt — i.e. the downstream handler never
 *      runs (Req 8.2 / 8.4).
 *
 * The test builds a fresh Express app + limiter per property run so each run
 * gets its own in-memory store, and uses a unique fixed client IP per run so
 * request counts never leak across runs. A large `windowMs` (60s) keeps every
 * request within a single window.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4
 */
import fc from 'fast-check';
import express, { type Express } from 'express';
import request from 'supertest';
import { createRateLimiter } from './rateLimit';

/**
 * Build a fresh Express app exposing `POST /try` guarded by a rate limiter of
 * `max = L` requests per `windowMs`. The downstream handler responds
 * `200 { ok: true }`; observing this body proves the handler actually ran.
 */
function buildApp(max: number, windowMs: number): Express {
  const app = express();
  app.set('trust proxy', true);
  const limiter = createRateLimiter({ max, windowMs });
  app.post('/try', limiter, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('Property 20: Rate limiting enforces the per-endpoint boundary', () => {
  it('permits the first L requests and blocks the (L+1)th with a well-formed 429', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Small limit so each run makes only L+1 HTTP calls.
        fc.integer({ min: 1, max: 5 }),
        // Unique client IP per run so counts never leak across runs.
        fc.integer({ min: 0, max: 255 }),
        async (limit, ipOctet) => {
          const windowMs = 60_000; // large window: all requests share one window
          const clientIp = `203.0.113.${ipOctet}`;
          const app = buildApp(limit, windowMs);

          // The first `limit` requests are within the boundary → 200 + handler ran.
          for (let i = 0; i < limit; i++) {
            const res = await request(app)
              .post('/try')
              .set('X-Forwarded-For', clientIp);
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ ok: true });
          }

          // The (limit + 1)th request exceeds the boundary → 429, not processed.
          const blocked = await request(app)
            .post('/try')
            .set('X-Forwarded-For', clientIp);

          expect(blocked.status).toBe(429);

          // Integer Retry-After header in [1, 60].
          const retryAfter = Number(blocked.headers['retry-after']);
          expect(Number.isInteger(retryAfter)).toBe(true);
          expect(retryAfter).toBeGreaterThanOrEqual(1);
          expect(retryAfter).toBeLessThanOrEqual(60);

          // Shared ErrorBody shape with the rate_limited code.
          expect(blocked.body?.error?.code).toBe('rate_limited');

          // Downstream handler did NOT run: the body is the error, not { ok: true }.
          expect(blocked.body).not.toEqual({ ok: true });
        },
      ),
      // Each run makes L+1 HTTP calls; keep the run count modest.
      { numRuns: 30 },
    );
  });
});
