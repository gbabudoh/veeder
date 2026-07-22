/**
 * Endpoint happy-path integration tests (task 16.3).
 *
 * These are full HTTP flows exercised with supertest against the real Express
 * app (built by {@link createApp}) wired to a real PostgreSQL database with the
 * project's migrations applied. They validate the success contracts of the five
 * endpoints end-to-end:
 *
 *   - POST /register  → 201 { id, email }              (Req 1.4)
 *   - POST /login     → 200 { accessToken, refreshToken } (Req 3.4)
 *   - POST /refresh   → 200 new token pair; old token now rejected (Req 4.3)
 *   - GET  /me        → 200 { id, email } for the caller (Req 7.1)
 *   - POST /logout    → 200; subsequent refresh with that token → 401 (Req 5.2)
 *
 * Requiring a real database, the suite is GUARDED: it runs only when a
 * disposable test database is configured via `DATABASE_URL_TEST` (or
 * `PGDATABASE_TEST`), and is a clean no-op otherwise. This keeps the default
 * `jest` run green in environments without PostgreSQL while still providing full
 * coverage in CI where a test database is provisioned.
 *
 * The test bootstrap (`src/test/setup.ts`) forces `APP_ENV=test` before any test
 * module is imported, so the shared knex instance below (`import { knex }`) is
 * already bound to the `test` Knex configuration, which reads `DATABASE_URL_TEST`
 * / `PGDATABASE_TEST`. The same bootstrap also supplies a valid (>= 32 char)
 * `JWT_SIGNING_KEY`, so `loadConfig()` succeeds here without extra setup.
 */

import request from 'supertest';
import type { Express } from 'express';

import { knex } from '../db/knex';
import { createApp } from '../app';
import { loadConfig } from '../config';

/**
 * True only when a disposable test database is configured. Both variables are
 * honored by the `test` Knex config in `src/db/knexConfig.ts`.
 */
const HAS_TEST_DB = !!(process.env.DATABASE_URL_TEST || process.env.PGDATABASE_TEST);

/** Run the suite only when a test DB is present; otherwise skip cleanly. */
const describeIntegration = HAS_TEST_DB ? describe : describe.skip;

if (!HAS_TEST_DB) {
  // Explain how to enable the suite so a skipped run is self-documenting.
  // eslint-disable-next-line no-console
  console.info(
    '[integration] Skipping endpoint integration tests: no test database configured. ' +
      'Set DATABASE_URL_TEST (or PGDATABASE_TEST) to a disposable PostgreSQL database to enable them.',
  );
}

describeIntegration('endpoint happy paths (supertest + real DB)', () => {
  let app: Express;

  beforeAll(async () => {
    // Apply the project's migrations to the (disposable) test database, then
    // build the real app. In the `test` env `httpsRequired` is false, so plain
    // HTTP requests from supertest pass the HTTPS-enforcement middleware.
    await knex.migrate.latest();
    app = createApp(loadConfig());
  });

  afterEach(async () => {
    // Reset all tables between tests so each case starts from a clean slate.
    // CASCADE covers the refresh_tokens → users foreign key.
    await knex.raw(
      'TRUNCATE TABLE auth_events, refresh_tokens, users RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    // Roll every migration back (drop the schema) and close the pool so the
    // Jest process can exit cleanly.
    await knex.migrate.rollback({}, true);
    await knex.destroy();
  });

  const credentials = () => ({
    email: 'Integration.User@Example.com',
    password: 'sup3r-secret-pw',
  });

  it('registers a new account (POST /register → 201 { id, email }, no hash, row persisted)', async () => {
    const { email, password } = credentials();

    const res = await request(app).post('/register').send({ email, password });

    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.id.length).toBeGreaterThan(0);
    // Email is normalized (trimmed + lowercased) before persistence (Req 2.6).
    expect(res.body.email).toBe(email.trim().toLowerCase());
    // The password hash must never appear in the response (Req 1.6).
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('password_hash');

    // A corresponding row exists in `users`.
    const row = await knex('users').where({ id: res.body.id }).first();
    expect(row).toBeDefined();
    expect(row.email).toBe(email.trim().toLowerCase());
  });

  it('logs in with valid credentials (POST /login → 200 { accessToken, refreshToken })', async () => {
    const { email, password } = credentials();
    await request(app).post('/register').send({ email, password }).expect(201);

    const res = await request(app).post('/login').send({ email, password });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.accessToken.length).toBeGreaterThan(0);
    expect(typeof res.body.refreshToken).toBe('string');
    expect(res.body.refreshToken.length).toBeGreaterThan(0);
  });

  it('refreshes the token pair and rejects reuse of the old token (POST /refresh → 200 then 401)', async () => {
    const { email, password } = credentials();
    await request(app).post('/register').send({ email, password }).expect(201);
    const login = await request(app).post('/login').send({ email, password }).expect(200);
    const originalRefresh = login.body.refreshToken as string;

    // Rotating a valid refresh token yields a brand-new pair (Req 4.3).
    const rotated = await request(app)
      .post('/refresh')
      .send({ refreshToken: originalRefresh });

    expect(rotated.status).toBe(200);
    expect(typeof rotated.body.accessToken).toBe('string');
    expect(typeof rotated.body.refreshToken).toBe('string');
    expect(rotated.body.refreshToken).not.toBe(originalRefresh);

    // The original (now-rotated) token must be rejected on reuse (Req 4.6).
    const reuse = await request(app)
      .post('/refresh')
      .send({ refreshToken: originalRefresh });
    expect(reuse.status).toBe(401);

    // The freshly issued token still works.
    const again = await request(app)
      .post('/refresh')
      .send({ refreshToken: rotated.body.refreshToken });
    expect(again.status).toBe(200);
  });

  it('returns the caller profile with a valid access token (GET /me → 200 { id, email })', async () => {
    const { email, password } = credentials();
    const register = await request(app)
      .post('/register')
      .send({ email, password })
      .expect(201);
    const login = await request(app).post('/login').send({ email, password }).expect(200);

    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(register.body.id);
    expect(res.body.email).toBe(email.trim().toLowerCase());
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  it('logs out and invalidates the refresh token (POST /logout → 200, then refresh → 401)', async () => {
    const { email, password } = credentials();
    await request(app).post('/register').send({ email, password }).expect(201);
    const login = await request(app).post('/login').send({ email, password }).expect(200);
    const refreshToken = login.body.refreshToken as string;

    // Logout always returns 200 for a valid, active token (Req 5.2).
    const logout = await request(app).post('/logout').send({ refreshToken });
    expect(logout.status).toBe(200);

    // The revoked token can no longer be refreshed (Req 5.4).
    const afterLogout = await request(app).post('/refresh').send({ refreshToken });
    expect(afterLogout.status).toBe(401);
  });
});
