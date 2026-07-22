/**
 * Express application assembly.
 *
 * Design reference: `design.md` → "Architecture" → "Middleware Pipeline
 * (ordering matters)", "Trusting the Source IP", and the "Endpoint Contracts"
 * table. This module composes the ordered middleware pipeline and mounts every
 * route, returning a ready-to-listen Express app. It does NOT start the HTTP
 * listener — binding the port and startup validation are the bootstrap's job
 * (task 16.2).
 *
 * The pipeline order is a security requirement, not an implementation detail
 * (design: "ordering is a security requirement"):
 *
 *   1. `trust proxy`            — so `req.ip` / `req.secure` reflect the real
 *                                 client behind the configured proxy hop count
 *                                 (Req 8.1, 8.3, used by rate limiting + HTTPS).
 *   2. HTTPS enforcement        — reject insecure requests in non-local envs
 *                                 before any work/logging occurs (Req 10.4).
 *   3. Request logging          — structured logging with secret redaction
 *                                 (Req 10.5).
 *   4. Body parsing             — `express.json()` with a bounded size limit.
 *   5. Rate limiting + routes   — the login/registration rate limiters are
 *                                 applied inside their routers, and the auth
 *                                 guard inside the `/me` router (Req 6.1, 8.1,
 *                                 8.3); this module mounts the routers at their
 *                                 contract paths.
 *   6. 404 fallback             — unmatched routes forward a NotFoundError.
 *   7. Error handler (LAST)     — the single formatting authority converting
 *                                 typed errors into the shared ErrorBody shape
 *                                 (Req 9.1, 9.2).
 *
 * Import side-effects are avoided: no default app is constructed at import time
 * (which would call `loadConfig()` and throw without a configured environment).
 * Instead {@link createApp} is the primary entry point and the bootstrap passes
 * an explicit config; {@link getApp} offers a lazily-built default for
 * convenience.
 */

import express, { type Express } from 'express';
import cors from 'cors';

import { loadConfig, type AppConfig } from './config';
import { NotFoundError } from './errors';
import { createHttpsEnforcement } from './middleware/httpsEnforcement';
import { createRequestLogger, logger } from './middleware/requestLogger';
import { createErrorHandler } from './middleware/errorHandler';

import { registerRouter } from './routes/register';
import loginRouter from './routes/login';
import { refreshRouter } from './routes/refresh';
import { logoutRouter } from './routes/logout';
import { meRouter } from './routes/me';
import { adminRouter } from './routes/admin';

/**
 * Maximum accepted JSON request body size. Kept small to bound abuse — the API
 * only ever accepts a couple of short string fields (email/password/token).
 */
const JSON_BODY_LIMIT = '16kb';

/**
 * Build the Express application with the ordered middleware pipeline and all
 * routes mounted.
 *
 * @param config resolved application configuration. Defaults to
 *   {@link loadConfig}() so production callers get environment-driven behavior;
 *   tests pass an explicit config (e.g. `httpsRequired: false`, a custom
 *   `trustProxyHops`) to exercise the app without a full environment.
 * @returns a configured {@link Express} app that has not yet bound a listener.
 */
export function createApp(config: AppConfig = loadConfig()): Express {
  const app = express();

  // 1. Trust the configured number of proxy hops so `req.ip` and `req.secure`
  //    reflect the real client behind a TLS-terminating load balancer. This
  //    underpins per-IP rate limiting and HTTPS detection (Req 8.1, 8.3, 10.4).
  app.set('trust proxy', config.trustProxyHops);

  // CORS: allow the admin dashboard (Vite dev on :5173, or any configured
  // origin via CORS_ORIGIN env var) to reach the API.
  const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    }),
  );

  // 2. HTTPS enforcement runs first: insecure requests in non-local envs are
  //    rejected before any body parsing, logging, or handler work (Req 10.4).
  app.use(createHttpsEnforcement({ httpsRequired: config.httpsRequired }));

  // 3. Request logging with secret redaction (Req 10.5).
  app.use(createRequestLogger());

  // 4. Body parsing (JSON, size-limited to bound abuse).
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  // 5. Routes. Rate limiters (login/registration) live inside their routers and
  //    the access-token auth guard lives inside the `/me` router, so mounting
  //    each router at its contract base path wires the full pipeline
  //    (Req 6.1, 8.1, 8.3). Paths match design "Endpoint Contracts".
  app.use('/register', registerRouter); // POST /register
  app.use('/login', loginRouter); //       POST /login
  app.use('/refresh', refreshRouter); //   POST /refresh
  app.use('/logout', logoutRouter); //     POST /logout
  app.use('/me', meRouter); //             GET  /me
  // Admin API: the `authGuard` + `adminGuard` pipeline lives inside the router,
  // so mounting it here wires protected, admin-only `/admin/*` endpoints behind
  // the shared HTTPS/logging/body-parsing middleware (Req 3.2, 3.3, 3.5, 6.11).
  app.use('/admin', adminRouter); //       GET  /admin/{users,users/:id,activity,analytics}

  // 6. 404 fallback: forward a typed NotFoundError to the centralized handler so
  //    unmatched routes still produce the shared ErrorBody shape (Req 9.1).
  app.use((_req, _res, next) => {
    next(new NotFoundError('The requested resource was not found'));
  });

  // 7. Centralized error handler LAST — the single authority that converts typed
  //    errors into the shared ErrorBody shape and collapses unknown errors to a
  //    generic 500 without leaking internals (Req 9.1, 9.2).
  app.use(createErrorHandler(logger));

  return app;
}

/** Lazily-built default app, memoized after first construction. */
let defaultApp: Express | undefined;

/**
 * Return a lazily-constructed default app built from {@link loadConfig}(). The
 * app is created on first call (so importing this module has no side effects)
 * and memoized thereafter. Prefer {@link createApp} with an explicit config in
 * tests; use this where a process-wide singleton is convenient.
 */
export function getApp(): Express {
  if (defaultApp === undefined) {
    defaultApp = createApp();
  }
  return defaultApp;
}

export default createApp;
