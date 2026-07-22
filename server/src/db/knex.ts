import knexFactory, { Knex } from 'knex';
import { knexConfigs } from './knexConfig';

/**
 * Shared Knex instance for the application.
 *
 * The active configuration is selected from `APP_ENV` (matching the service's
 * environment model: local | test | staging | production), defaulting to
 * `development` when `APP_ENV` is unset. The configuration comes from the same
 * `knexConfigs` map that the root `knexfile.ts` re-exports, so the running
 * application and the migration CLI always share connection details.
 *
 * Consumers should import this single instance rather than constructing their
 * own pool. Tests are responsible for closing the pool via `knex.destroy()`
 * (or the `closePool` helper) to allow the process to exit cleanly.
 */
const appEnv = process.env.APP_ENV ?? 'development';
const config: Knex.Config = knexConfigs[appEnv] ?? knexConfigs.development;

export const knex: Knex = knexFactory(config);

/** Close the underlying connection pool. Primarily used by tests. */
export async function closePool(): Promise<void> {
  await knex.destroy();
}

export default knex;
