/**
 * Integration tests: latency bounds and audit-write failure (task 16.4).
 *
 * Design reference: `design.md` → "Endpoint Contracts" and
 * "Audit_Logger (`auditLogger`)". Validates Requirements 3.4, 4.3, 5.1, 7.1,
 * and 11.8 against the fully-assembled Express app running over a real,
 * disposable PostgreSQL database.
 *
 * These tests require a real test database and are GUARDED behind
 * `DATABASE_URL_TEST` / `PGDATABASE_TEST` exactly like the endpoint happy-path
 * integration suite (task 16.3). When neither is set the whole suite is skipped
 * with an explanatory `console.info`, so the default `npx jest` run (with no
 * test DB configured) passes cleanly rather than failing to connect.
 *
 * What is covered:
 *
 *  - Latency bounds (Req 3.4, 4.3, 5.1, 7.1): after registering and logging in a
 *    user, each of `POST /login`, `POST /refresh`, `POST /logout`, and
 *    `GET /me` is measured with `Date.now()` around the awaited supertest call
 *    and asserted to respond within 2000 ms. These are deliberately generous
 *    bounds — even an argon2 verify on login should complete well under 2s — so
 *    the assertion guards against pathological regressions without being flaky.
 *
 *  - Audit-write failure is non-blocking (Req 11.8): the Audit_Logger retries a
 *    failed insert up to 3 times and then swallows the failure so the
 *    originating operation is never interrupted. Login records its
 *    `login-success` event via the non-blocking Audit_Logger AFTER the token
 *    pair has been issued, so we break the `auth_events` table (rename it away
 *    so inserts throw) and assert that `POST /login` STILL returns `200` with a
 *    token pair. The table is restored afterwards in a `finally` block.
 *
 *    Note: registration writes its auth event INSIDE the registration
 *    transaction (atomic), so breaking `auth_events` would roll the whole
 *    registration back. We therefore exercise the non-blocking guarantee via
 *    the LOGIN path, where `recordLoginSuccess` runs outside the issuance path.
 */

import request from 'supertest';
import type { Express } from 'express';
import type { Knex } from 'knex';

// Guard: only run when a real test database is configured. Mirrors task 16.3.
const HAS_TEST_DB = !!(
  process.env.DATABASE_URL_TEST || process.env.PGDATABASE_TEST
);
const describeIntegration = HAS_TEST_DB ? describe : describe.skip;

if (!HAS_TEST_DB) {
  // eslint-disable-next-line no-console
  console.info(
    '[latencyAndAudit.integration] Skipped: no test database configured. ' +
      'Set DATABASE_URL_TEST (or PGDATABASE_TEST) to run these integration tests.',
  );
}

// Ensure the test environment is selected before importing modules that read
// APP_ENV (the shared knex instance and app configuration).
process.env.APP_ENV = 'test';

/** Generous per-endpoint latency bound in milliseconds (Req 3.4, 4.3, 5.1, 7.1). */
const LATENCY_BUDGET_MS = 2000;

/** All tables written by the API, in FK-safe truncation order. */
const TABLES = ['auth_events', 'refresh_tokens', 'users'] as const;

describeIntegration('latency bounds and audit-write failure (integration)', () => {
  let knex: Knex;
  let app: Express;

  beforeAll(async () => {
    // Import lazily so the guard/skip path never touches the database layer.
    knex = (await import('../db/knex')).knex;
    const { createApp } = await import('../app');

    // Apply all migrations to the disposable test database.
    await knex.migrate.latest();

    // Build the app with HTTPS enforcement disabled (test env) so supertest can
    // drive it over plain HTTP.
    app = createApp({
      httpsRequired: false,
      trustProxyHops: 0,
    } as Parameters<typeof createApp>[0]);
  });

  afterEach(async () => {
    // Reset state between tests. CASCADE + RESTART IDENTITY keeps FK-linked rows
    // consistent regardless of insertion order.
    await knex.raw(
      `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(async () => {
    // Roll every migration back and close the pool so the process exits cleanly.
    await knex.migrate.rollback(undefined, true);
    await knex.destroy();
  });

  /** Register then log in a user, returning the credentials and the token pair. */
  async function registerAndLogin(): Promise<{
    email: string;
    password: string;
    accessToken: string;
    refreshToken: string;
  }> {
    const email = `latency+${Date.now()}@example.com`;
    const password = 'correct horse battery';

    const registerRes = await request(app)
      .post('/register')
      .send({ email, password });
    expect(registerRes.status).toBe(201);

    const loginRes = await request(app).post('/login').send({ email, password });
    expect(loginRes.status).toBe(200);
    expect(typeof loginRes.body.accessToken).toBe('string');
    expect(typeof loginRes.body.refreshToken).toBe('string');

    return {
      email,
      password,
      accessToken: loginRes.body.accessToken,
      refreshToken: loginRes.body.refreshToken,
    };
  }

  it('responds to login/refresh/logout/me within the latency budget (Req 3.4, 4.3, 5.1, 7.1)', async () => {
    const { email, password, accessToken, refreshToken } =
      await registerAndLogin();

    // POST /login (Req 3.4)
    let start = Date.now();
    const loginRes = await request(app).post('/login').send({ email, password });
    const loginElapsed = Date.now() - start;
    expect(loginRes.status).toBe(200);
    expect(loginElapsed).toBeLessThan(LATENCY_BUDGET_MS);

    // POST /refresh (Req 4.3) — rotate the refresh token issued at login.
    start = Date.now();
    const refreshRes = await request(app)
      .post('/refresh')
      .send({ refreshToken });
    const refreshElapsed = Date.now() - start;
    expect(refreshRes.status).toBe(200);
    expect(refreshElapsed).toBeLessThan(LATENCY_BUDGET_MS);

    // GET /me (Req 7.1) — protected route behind the auth guard.
    start = Date.now();
    const meRes = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${accessToken}`);
    const meElapsed = Date.now() - start;
    expect(meRes.status).toBe(200);
    expect(meElapsed).toBeLessThan(LATENCY_BUDGET_MS);

    // POST /logout (Req 5.1) — best-effort revocation, always 200.
    start = Date.now();
    const logoutRes = await request(app)
      .post('/logout')
      .send({ refreshToken: refreshRes.body.refreshToken });
    const logoutElapsed = Date.now() - start;
    expect(logoutRes.status).toBe(200);
    expect(logoutElapsed).toBeLessThan(LATENCY_BUDGET_MS);
  });

  it('login still succeeds when the audit write fails (non-blocking, Req 11.8)', async () => {
    const { email, password } = await registerAndLogin();

    // Break the auth_events table so any Audit_Logger insert throws. Login
    // records `login-success` via the non-blocking Audit_Logger AFTER issuing
    // the token pair, so the write failure must NOT interrupt the login.
    await knex.raw('ALTER TABLE auth_events RENAME TO auth_events_tmp');
    try {
      const start = Date.now();
      const loginRes = await request(app)
        .post('/login')
        .send({ email, password });
      const elapsed = Date.now() - start;

      // The originating operation still succeeds with a token pair: the audit
      // write failure was retried and then swallowed (Req 11.8).
      expect(loginRes.status).toBe(200);
      expect(typeof loginRes.body.accessToken).toBe('string');
      expect(typeof loginRes.body.refreshToken).toBe('string');
      expect(elapsed).toBeLessThan(LATENCY_BUDGET_MS);
    } finally {
      // Always restore the table so afterEach truncation and other tests work.
      await knex.raw('ALTER TABLE auth_events_tmp RENAME TO auth_events');
    }
  });
});
