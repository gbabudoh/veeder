/**
 * Configuration loader for the user-registration-backend.
 *
 * `loadConfig` reads and validates environment values once at startup and
 * returns a fully-typed {@link AppConfig}. Fixed contract constants required by
 * the specification (access-token TTL, refresh-token TTL, and the per-endpoint
 * rate limits) are centralized here so the rest of the service depends on a
 * single source of truth (design: "those constants are treated as fixed
 * contract values and centralized in a single configuration module").
 *
 * The signing-key gate (Req 10.2) is enforced here: `loadConfig` throws a
 * {@link ConfigError} when `JWT_SIGNING_KEY` is missing/empty or shorter than
 * 32 characters. Actually aborting the process (exit non-zero, remain
 * not-serving) is the responsibility of the bootstrap (task 16.2); this module
 * only surfaces the failure by throwing.
 */

/** The set of environments the service understands. */
export type AppEnv = 'local' | 'development' | 'test' | 'staging' | 'production';

/** Minimum length, in characters, of the JWT signing key (Req 10.2). */
export const MIN_SIGNING_KEY_LENGTH = 32;

/** Access-token lifetime: 15 minutes (Req 3.2, 4.1). */
export const ACCESS_TOKEN_TTL_SECONDS = 900 as const;

/** Refresh-token lifetime: 30 days (Req 3.3, 4.2). */
export const REFRESH_TOKEN_TTL_SECONDS = 2_592_000 as const;

/** A per-endpoint rate-limit rule: `max` requests per `windowSeconds`. */
export interface RateLimitConfig {
  readonly max: number;
  readonly windowSeconds: number;
}

/** Fixed correctness constants that never vary by environment. */
export interface AppConstants {
  readonly accessTokenTtlSeconds: typeof ACCESS_TOKEN_TTL_SECONDS;
  readonly refreshTokenTtlSeconds: typeof REFRESH_TOKEN_TTL_SECONDS;
  readonly loginRateLimit: RateLimitConfig;
  readonly registrationRateLimit: RateLimitConfig;
}

/** Fully-resolved, typed application configuration. */
export interface AppConfig {
  /** Normalized environment name. */
  readonly appEnv: AppEnv;
  /** Whether inbound HTTPS is required (false for local/test, true otherwise; Req 10.4). */
  readonly httpsRequired: boolean;
  /** JWT signing key, validated to be >= 32 characters (Req 10.1, 10.2). */
  readonly jwtSigningKey: string;
  /** PostgreSQL connection string. */
  readonly databaseUrl: string;
  /** Number of trusted proxy hops in front of the service. */
  readonly trustProxyHops: number;
  /** HTTP port the server binds to. */
  readonly port: number;
  /** Fixed contract constants. */
  readonly constants: AppConstants;
}

/**
 * Error thrown when the environment configuration is invalid. Carrying a
 * dedicated type lets the bootstrap distinguish configuration failures (which
 * should abort startup with a clear message) from other errors.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
    // Restore prototype chain for instanceof checks under transpiled targets.
    Object.setPrototypeOf(this, ConfigError.prototype);
  }
}

const DEFAULT_PORT = 3000;
const DEFAULT_TRUST_PROXY_HOPS = 0;

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Normalize an `APP_ENV` value to a known {@link AppEnv}. Unknown or missing
 * values default to `local`, matching the service's local-first defaults.
 */
function normalizeAppEnv(raw: string | undefined): AppEnv {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'production':
      return 'production';
    case 'staging':
      return 'staging';
    case 'test':
      return 'test';
    case 'development':
      return 'development';
    case 'local':
    case '':
      return 'local';
    default:
      return 'local';
  }
}

/**
 * HTTPS is enforced everywhere except local and test environments (Req 10.4).
 */
function deriveHttpsRequired(appEnv: AppEnv): boolean {
  return appEnv !== 'local' && appEnv !== 'test';
}

/**
 * Parse a non-negative integer from an environment value, falling back to
 * `fallback` when absent, and throwing when present but not a valid
 * non-negative integer.
 */
function parseNonNegativeInt(value: string | undefined, name: string, fallback: number): number {
  if (!isNonEmpty(value)) {
    return fallback;
  }
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ConfigError(`${name} must be a non-negative integer, received "${value}".`);
  }
  return parsed;
}

/**
 * Assemble a PostgreSQL connection string from the standard `PG*` variables,
 * mirroring the convention used by `src/db/knexConfig.ts` so migrations and the
 * application always agree on connection details.
 */
function assembleFromPgVars(env: NodeJS.ProcessEnv): string {
  const host = isNonEmpty(env.PGHOST) ? env.PGHOST : 'localhost';
  const port = isNonEmpty(env.PGPORT) ? env.PGPORT : '5432';
  const user = isNonEmpty(env.PGUSER) ? env.PGUSER : 'postgres';
  const password = env.PGPASSWORD;
  const database = isNonEmpty(env.PGDATABASE) ? env.PGDATABASE : 'veeder';

  const encodedUser = encodeURIComponent(user);
  const credentials = isNonEmpty(password)
    ? `${encodedUser}:${encodeURIComponent(password)}`
    : encodedUser;

  return `postgres://${credentials}@${host}:${port}/${database}`;
}

/**
 * Resolve the database connection string: prefer `DATABASE_URL`, otherwise
 * assemble it from the standard `PG*` variables (same order as knexConfig).
 */
function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string {
  if (isNonEmpty(env.DATABASE_URL)) {
    return env.DATABASE_URL;
  }
  return assembleFromPgVars(env);
}

/**
 * Load and validate configuration from the given environment object.
 *
 * Reading from the passed `env` (rather than touching `process.env` directly)
 * keeps this function pure and unit-testable without mutating global state.
 *
 * @throws {ConfigError} when `JWT_SIGNING_KEY` is missing/empty or shorter than
 *   {@link MIN_SIGNING_KEY_LENGTH} characters (Req 10.2), or when a numeric
 *   environment value is malformed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appEnv = normalizeAppEnv(env.APP_ENV);

  // Signing-key gate (Req 10.2): key must be present and >= 32 chars.
  const jwtSigningKey = env.JWT_SIGNING_KEY;
  if (!isNonEmpty(jwtSigningKey)) {
    throw new ConfigError(
      'JWT_SIGNING_KEY is missing: set an environment-provided signing key of at least ' +
        `${MIN_SIGNING_KEY_LENGTH} characters.`,
    );
  }
  if (jwtSigningKey.length < MIN_SIGNING_KEY_LENGTH) {
    throw new ConfigError(
      `JWT_SIGNING_KEY is too short: it must be at least ${MIN_SIGNING_KEY_LENGTH} characters, ` +
        `received ${jwtSigningKey.length}.`,
    );
  }

  const databaseUrl = resolveDatabaseUrl(env);
  const trustProxyHops = parseNonNegativeInt(
    env.TRUST_PROXY_HOPS,
    'TRUST_PROXY_HOPS',
    DEFAULT_TRUST_PROXY_HOPS,
  );
  const port = parseNonNegativeInt(env.PORT, 'PORT', DEFAULT_PORT);

  return {
    appEnv,
    httpsRequired: deriveHttpsRequired(appEnv),
    jwtSigningKey,
    databaseUrl,
    trustProxyHops,
    port,
    constants: {
      accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_SECONDS,
      loginRateLimit: { max: 10, windowSeconds: 60 },
      registrationRateLimit: { max: 5, windowSeconds: 60 },
    },
  };
}

export default loadConfig;
