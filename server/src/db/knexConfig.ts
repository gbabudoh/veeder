import 'dotenv/config';
import type { Knex } from 'knex';

/**
 * Shared Knex configuration for the user-registration-backend.
 *
 * This module is the single source of truth for how the service connects to
 * PostgreSQL. Both the root `knexfile.ts` (used by the Knex migration CLI) and
 * the runtime connection module (`src/db/knex.ts`) import their configuration
 * from here, so migrations and the application always agree on connection
 * details, the migrations directory, and the TypeScript migration extension.
 *
 * Connection resolution order (Req 11.1/10.3 use the same datastore):
 *   1. `DATABASE_URL` when present (preferred, matches `.env.example`).
 *   2. Otherwise assembled from the standard `PG*` variables.
 * The `test` environment additionally prefers `DATABASE_URL_TEST` /
 * `PGDATABASE_TEST` so tests run against a disposable database.
 */

const MIGRATIONS_DIR = './src/db/migrations';

/** Shared migration settings: TypeScript migrations under src/db/migrations. */
const migrations: Knex.MigratorConfig = {
  directory: MIGRATIONS_DIR,
  extension: 'ts',
  // Ensure the Knex CLI (via ts-node) only picks up .ts migration files.
  loadExtensions: ['.ts'],
};

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Resolve the SSL setting for the connection from `DB_SSL`.
 *
 * Remote / managed PostgreSQL (e.g. a VPS or cloud provider) typically requires
 * TLS. Set `DB_SSL` to enable it:
 *   - `require` / `true` : enable SSL. If `DB_SSL_REJECT_UNAUTHORIZED` is
 *                          `false` (common when the server uses a self-signed
 *                          certificate), certificate verification is disabled.
 *   - unset / `false` / `disable` : no SSL (default; suitable for localhost).
 *
 * Returns `undefined` when SSL is disabled so the pg driver connects in plain
 * mode, or an ssl options object otherwise.
 */
function resolveSsl(): Knex.PgConnectionConfig['ssl'] {
  const mode = (process.env.DB_SSL ?? '').trim().toLowerCase();
  const enabled = mode === 'require' || mode === 'true' || mode === '1';
  if (!enabled) {
    return undefined;
  }
  // Default to verifying the certificate; allow opting out for self-signed
  // certs via DB_SSL_REJECT_UNAUTHORIZED=false.
  const rejectUnauthorized =
    (process.env.DB_SSL_REJECT_UNAUTHORIZED ?? 'true').trim().toLowerCase() !==
    'false';
  return { rejectUnauthorized };
}

/** Assemble a connection string from the standard PG* environment variables. */
function assembleFromPgVars(databaseOverride?: string): string {
  const host = process.env.PGHOST ?? 'localhost';
  const port = process.env.PGPORT ?? '5432';
  const user = process.env.PGUSER ?? 'postgres';
  const password = process.env.PGPASSWORD ?? '';
  const database = databaseOverride ?? process.env.PGDATABASE ?? 'veeder';

  const encodedUser = encodeURIComponent(user);
  const credentials = isNonEmpty(password)
    ? `${encodedUser}:${encodeURIComponent(password)}`
    : encodedUser;

  return `postgres://${credentials}@${host}:${port}/${database}`;
}

/**
 * Resolve the PostgreSQL connection string for the given environment kind.
 * The connection is resolved lazily (per config build) so environment values
 * loaded from `.env` are always honored.
 */
function resolveConnectionString(isTest: boolean): string {
  if (isTest) {
    if (isNonEmpty(process.env.DATABASE_URL_TEST)) {
      return process.env.DATABASE_URL_TEST;
    }
    if (isNonEmpty(process.env.PGDATABASE_TEST)) {
      return assembleFromPgVars(process.env.PGDATABASE_TEST);
    }
  }

  if (isNonEmpty(process.env.DATABASE_URL)) {
    return process.env.DATABASE_URL;
  }

  return assembleFromPgVars();
}

/** Build a Knex config for an environment. */
function makeConfig(isTest: boolean): Knex.Config {
  const ssl = resolveSsl();
  const connectionString = resolveConnectionString(isTest);

  // When SSL is enabled we must pass a connection object (string + ssl) rather
  // than a bare connection string so the pg driver applies the TLS options.
  const connection: Knex.PgConnectionConfig =
    ssl === undefined
      ? { connectionString }
      : { connectionString, ssl };

  return {
    client: 'pg',
    connection,
    pool: { min: 0, max: 10 },
    migrations,
  };
}

/**
 * Knex configurations keyed by environment name.
 *
 * Includes both the conventional Knex names (`development`, `test`,
 * `production`) and the service's `APP_ENV` values (`local`, `staging`) so the
 * same file works whether the environment is selected by the Knex CLI or by
 * the application's `APP_ENV`.
 */
export const knexConfigs: Record<string, Knex.Config> = {
  local: makeConfig(false),
  development: makeConfig(false),
  test: makeConfig(true),
  staging: makeConfig(false),
  production: makeConfig(false),
};

export default knexConfigs;
