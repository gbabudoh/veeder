import 'dotenv/config';
import type { Knex } from 'knex';
import { knexConfigs } from './src/db/knexConfig';

/**
 * Knex CLI entry point.
 *
 * The Knex migration CLI loads this file (via `--knexfile knexfile.ts`) and
 * selects an environment by name (default `development`, or the value of
 * `NODE_ENV`). The actual configuration lives in `src/db/knexConfig.ts` so the
 * running application and the migration tooling share one definition.
 *
 * Migrations are TypeScript files under `src/db/migrations` (created in tasks
 * 3.1-3.3); the Knex CLI compiles them with ts-node.
 */
const config: { [environment: string]: Knex.Config } = knexConfigs;

export default config;
