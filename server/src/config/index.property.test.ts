// Feature: user-registration-backend, Property 22: Signing-key length gate
/**
 * Property 22: Signing-key length gate — Validates: Requirements 10.2
 *
 * For any candidate `JWT_SIGNING_KEY`, `loadConfig(env)` throws a
 * {@link ConfigError} iff the key is missing or shorter than
 * {@link MIN_SIGNING_KEY_LENGTH} (32) characters, and otherwise succeeds
 * returning a config whose `jwtSigningKey` equals the supplied key.
 *
 * The env is built with a valid `DATABASE_URL` and `APP_ENV=test` so that the
 * signing-key gate is the only condition under test (`loadConfig` is pure and
 * requires no database). Generators cover key lengths spanning the 32-char
 * boundary (0..40) as well as larger keys.
 *
 * Note: the loader treats a whitespace-only key as "missing"; to keep the pure
 * length-vs-boundary relationship under test, generated keys are drawn from
 * non-whitespace characters.
 */
import fc from 'fast-check';

import { loadConfig, ConfigError, MIN_SIGNING_KEY_LENGTH } from './index';

// Non-whitespace, printable ASCII characters used to build candidate keys so
// that key length (not trimming) is the sole factor exercised by the gate.
const KEY_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+';

const keyChar = fc.constantFrom(...KEY_CHARS.split(''));

/** An arbitrary producing a non-whitespace string of exactly `len` characters. */
function keyOfLength(len: number): fc.Arbitrary<string> {
  return fc
    .array(keyChar, { minLength: len, maxLength: len })
    .map((chars) => chars.join(''));
}

// Candidate keys: undefined (missing) plus strings of lengths that densely
// cover the boundary (0..40) and extend to larger sizes.
const candidateKey: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.nat({ max: 40 }).chain((len) => keyOfLength(len)),
  fc.integer({ min: 41, max: 256 }).chain((len) => keyOfLength(len)),
);

const VALID_DATABASE_URL = 'postgres://user:pass@localhost:5432/veeder';

function buildEnv(key: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    APP_ENV: 'test',
    DATABASE_URL: VALID_DATABASE_URL,
  };
  if (key !== undefined) {
    env.JWT_SIGNING_KEY = key;
  }
  return env;
}

describe('Property 22: Signing-key length gate (Req 10.2)', () => {
  it('throws iff the signing key is missing or shorter than 32 chars, else returns it', () => {
    fc.assert(
      fc.property(candidateKey, (key) => {
        const env = buildEnv(key);
        const tooShort = key === undefined || key.length < MIN_SIGNING_KEY_LENGTH;

        if (tooShort) {
          expect(() => loadConfig(env)).toThrow(ConfigError);
        } else {
          const config = loadConfig(env);
          expect(config.jwtSigningKey).toBe(key);
        }
      }),
      { numRuns: 100 },
    );
  });
});
