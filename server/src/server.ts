/**
 * Server bootstrap with startup validation.
 *
 * Design reference: `design.md` → "Architecture" → "Startup Validation":
 * "At boot, a configuration loader validates required environment values before
 * the HTTP listener binds. If `JWT_SIGNING_KEY` is absent or shorter than 32
 * characters, the process logs a startup error and exits non-zero without ever
 * serving traffic (Req 10.2). Database connectivity is also verified at startup
 * so the service fails fast on misconfiguration."
 *
 * Ordering is a correctness requirement, not an implementation detail:
 *
 *   1. `loadConfig()`            — validates the environment. A {@link ConfigError}
 *                                  (missing/short `JWT_SIGNING_KEY`, Req 10.2) is
 *                                  logged as fatal and aborts startup non-zero;
 *                                  the listener is NEVER bound (Req 10.1, 10.2).
 *   2. Database connectivity     — `SELECT 1` must succeed before binding so the
 *                                  service fails fast on a misconfigured / down
 *                                  datastore.
 *   3. `createApp(config)` +      — only after both checks pass do we build the
 *      `app.listen(port)`           app and bind the HTTP listener, logging the
 *                                  port we are serving on.
 *
 * The auto-run at the bottom is guarded by `require.main === module` so that
 * importing this module (e.g. from a test) exports {@link main} without starting
 * the server or opening a listener.
 *
 * This file is named `server.ts` on purpose: it compiles to `dist/server.js`,
 * which the package.json `start` script (`node dist/server.js`) executes.
 */

import type { Server } from 'http';

import { createApp } from './app';
import { loadConfig } from './config';
import { knex, closePool } from './db/knex';
import { logger } from './middleware/requestLogger';

/**
 * Process exit codes used by the bootstrap. `0` is success (only used by the
 * graceful-shutdown path); any non-zero value signals a failed startup so an
 * orchestrator (systemd, Kubernetes, etc.) can react (Req 10.2).
 */
const EXIT_FAILURE = 1;

/**
 * Verify the datastore is reachable before binding the listener. A trivial
 * `SELECT 1` round-trips the connection pool; any rejection means the database
 * is unavailable or misconfigured and startup must abort.
 */
async function verifyDatabaseConnectivity(): Promise<void> {
  await knex.raw('select 1');
}

/**
 * Install best-effort graceful-shutdown handlers. On SIGTERM/SIGINT the HTTP
 * listener stops accepting new connections and the database pool is destroyed,
 * then the process exits cleanly. Kept intentionally simple: failures during
 * shutdown are logged but never block the exit.
 */
function installShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Received shutdown signal, closing server');

    server.close((closeErr?: Error) => {
      if (closeErr) {
        logger.error({ err: closeErr }, 'Error while closing HTTP server');
      }
      closePool()
        .catch((poolErr: unknown) => {
          logger.error({ err: poolErr }, 'Error while closing database pool');
        })
        .finally(() => {
          process.exit(0);
        });
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/**
 * Bootstrap the service.
 *
 * Loads and validates configuration, verifies database connectivity, and only
 * then builds the Express app and binds the HTTP listener. On any failure it
 * logs a clear fatal message and exits with a non-zero code without ever
 * serving traffic (Req 10.1, 10.2).
 *
 * Exported for testability: importing this module does not invoke `main`.
 *
 * @returns the bound {@link Server} on success. Failure paths call
 *   `process.exit` and therefore do not return.
 */
export async function main(): Promise<Server | undefined> {
  // 1. Load and validate configuration. A ConfigError here means the signing
  //    key is missing or too short (Req 10.2) — log fatal and abort without
  //    binding the listener; the service remains not-serving.
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    logger.fatal(
      { err },
      'Startup aborted: invalid configuration (JWT signing key missing or too short). ' +
        'The server will not start.',
    );
    process.exit(EXIT_FAILURE);
    return undefined;
  }

  // 2. Verify database connectivity so we fail fast on a down/misconfigured
  //    datastore rather than after the listener is already accepting traffic.
  try {
    await verifyDatabaseConnectivity();
  } catch (err) {
    logger.fatal(
      { err },
      'Startup aborted: could not reach the database. The server will not start.',
    );
    process.exit(EXIT_FAILURE);
    return undefined;
  }

  // 3. Both checks passed — build the app and bind the HTTP listener.
  try {
    const app = createApp(config);
    const server = app.listen(config.port, () => {
      logger.info({ port: config.port, appEnv: config.appEnv }, 'Server listening');
    });
    installShutdownHandlers(server);
    return server;
  } catch (err) {
    // Any unexpected error during app assembly or listener binding.
    logger.fatal({ err }, 'Startup aborted: unexpected error during bootstrap.');
    process.exit(EXIT_FAILURE);
    return undefined;
  }
}

// Auto-run only when executed directly (`node dist/server.js` / `ts-node
// src/server.ts`). Importing this module in tests must NOT start the server.
if (require.main === module) {
  void main().catch((err: unknown) => {
    // Last-resort guard for any error escaping main (e.g. a synchronous throw
    // before the try/catch blocks). Log and exit non-zero, never serving.
    logger.fatal({ err }, 'Startup aborted: unhandled error during bootstrap.');
    process.exit(EXIT_FAILURE);
  });
}

export default main;
