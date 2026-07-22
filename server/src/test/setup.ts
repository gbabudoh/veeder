/**
 * Global test bootstrap (referenced by jest.config.js `setupFilesAfterEnv`).
 *
 * Responsibilities:
 *  - Load a `test` environment: optionally read a `.env.test` file, force
 *    `APP_ENV=test`, provide a >= 32 character default `JWT_SIGNING_KEY` when
 *    one is not already supplied, and pass through a `DATABASE_URL` from the
 *    environment when provided.
 *  - Configure fast-check to run a minimum of 100 iterations per property.
 */
import path from 'path';
import dotenv from 'dotenv';
import fc from 'fast-check';

// Load a test-specific env file if present. Values already set in the
// environment take precedence, so CI can override without editing files.
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.test') });

// Tests always run in the `test` environment (HTTPS enforcement off, etc.).
process.env.APP_ENV = 'test';

// Provide a deterministic signing key of >= 32 characters for tests when the
// environment does not already supply a valid one. Real secrets are injected
// via the environment in CI/deployment.
const DEFAULT_TEST_SIGNING_KEY =
  'test-jwt-signing-key-0123456789-abcdefghij'; // 42 chars, >= 32
if (
  !process.env.JWT_SIGNING_KEY ||
  process.env.JWT_SIGNING_KEY.length < 32
) {
  process.env.JWT_SIGNING_KEY = DEFAULT_TEST_SIGNING_KEY;
}

// DATABASE_URL is intentionally left as-is: database-backed tests read it from
// the environment when provided, and pure-logic tests do not require it.

// Every property test runs a minimum of 100 iterations (design requirement).
fc.configureGlobal({ numRuns: 100 });
