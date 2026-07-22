// Feature: user-registration-backend, Property 25: Log output redacts secrets
/**
 * Property 25: Log output redacts secrets —
 * Validates: Requirements 10.5
 *
 * For any JSON-like payload, {@link redact} must guarantee three things:
 *   1. Secrecy — the value of every property named (case-insensitive)
 *      `password`, `accessToken`/`access_token`, `refreshToken`/`refresh_token`,
 *      or `authorization` is replaced by {@link REDACTION_PLACEHOLDER}, so a
 *      unique sentinel secret string planted as such a value never survives into
 *      the serialized output (Req 10.5).
 *   2. Purity — the input payload is never mutated; a structural deep copy taken
 *      before the call remains deep-equal to the original afterward.
 *   3. Preservation — non-secret keys and their values are carried through
 *      unchanged, including a planted non-secret sentinel value.
 *
 * The generator builds an arbitrary recursive object/array structure and then
 * injects, at a random position and depth, both a secret key holding a unique
 * secret sentinel and a non-secret key holding a unique benign sentinel, so
 * every run exercises redaction of a real secret alongside preservation of a
 * real non-secret.
 */
import fc from 'fast-check';

import { redact, REDACTION_PLACEHOLDER } from './requestLogger';

/** Case-insensitive set of the property names whose values must be redacted. */
const SECRET_KEY_NAMES = [
  'password',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'authorization',
] as const;

function isSecretKeyName(key: string): boolean {
  return SECRET_KEY_NAMES.some((k) => k.toLowerCase() === key.toLowerCase());
}

/**
 * Keys that JavaScript treats specially on plain objects: assigning them via an
 * object literal / bracket syntax does not create an own enumerable property
 * (`__proto__` sets the prototype; `constructor`/`prototype` collide with
 * built-ins). They never appear as real log-payload keys, so excluding them
 * keeps the "benign value survives" assertion meaningful.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Object keys that are guaranteed not to collide with any secret key name. */
const nonSecretKey: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((k) => !isSecretKeyName(k) && !DANGEROUS_KEYS.has(k));

/**
 * An arbitrary JSON-like value: primitives at the leaves, with plain objects
 * and arrays nested up to a small depth. Object keys are constrained to
 * non-secret identifiers so the base structure never accidentally contains a
 * secret key (secrets are injected deliberately by {@link plantedPayload}).
 */
const jsonLikeValue: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  leaf: fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
  ),
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    tie('leaf'),
    fc.array(tie('node'), { maxLength: 4 }),
    fc.dictionary(nonSecretKey, tie('node'), { maxKeys: 4 }),
  ),
})).node;

/**
 * A payload with a secret sentinel and a benign sentinel planted inside a
 * generated JSON-like container. The container is always an object so we can
 * attach the planted keys; the surrounding structure is arbitrary, and the
 * planted keys may themselves be nested behind an arbitrary generated subtree.
 */
interface PlantedPayload {
  payload: Record<string, unknown>;
  secretSentinel: string;
  benignSentinel: string;
  benignKey: string;
  secretKeyName: string;
}

const plantedPayload: fc.Arbitrary<PlantedPayload> = fc
  .record({
    // Unique sentinels: a UUID prefix makes accidental collisions with random
    // generated strings vanishingly unlikely.
    secretSentinel: fc.uuid().map((u) => `SECRET-${u}`),
    benignSentinel: fc.uuid().map((u) => `BENIGN-${u}`),
    secretKeyName: fc.constantFrom(...SECRET_KEY_NAMES),
    benignKey: nonSecretKey,
    surrounding: fc.dictionary(nonSecretKey, jsonLikeValue, { maxKeys: 4 }),
    nestUnderArray: fc.boolean(),
    nestDepth: fc.integer({ min: 0, max: 3 }),
  })
  .map(
    ({
      secretSentinel,
      benignSentinel,
      secretKeyName,
      benignKey,
      surrounding,
      nestUnderArray,
      nestDepth,
    }) => {
      // Innermost object carrying both the secret and a benign sibling.
      let inner: unknown = {
        ...surrounding,
        [secretKeyName]: secretSentinel,
        [benignKey]: benignSentinel,
      };

      // Optionally bury the inner object under some arrays/objects to exercise
      // redaction at varying depths.
      for (let i = 0; i < nestDepth; i += 1) {
        inner = nestUnderArray ? [inner] : { [`level_${i}`]: inner };
      }

      return {
        payload: { root: inner } as Record<string, unknown>,
        secretSentinel,
        benignSentinel,
        benignKey,
        secretKeyName,
      };
    },
  );

/** Recursively collect the values of every secret-named key found in `value`. */
function collectSecretKeyValues(value: unknown, out: unknown[]): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSecretKeyValues(item, out);
    }
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKeyName(key)) {
      out.push(nested);
    }
    collectSecretKeyValues(nested, out);
  }
}

/** Recursively test whether `sentinel` appears as a value anywhere in `value`. */
function containsValue(value: unknown, sentinel: string): boolean {
  if (value === sentinel) {
    return true;
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsValue(item, sentinel));
  }
  return Object.values(value as Record<string, unknown>).some((v) =>
    containsValue(v, sentinel),
  );
}

describe('Property 25: Log output redacts secrets (Req 10.5)', () => {
  it('redacts every secret value, never mutates input, and preserves non-secrets', () => {
    fc.assert(
      fc.property(plantedPayload, (planted) => {
        const { payload, secretSentinel, benignSentinel } = planted;

        // Structural deep copy taken BEFORE redaction to prove non-mutation.
        const before = structuredClone(payload);

        const r = redact(payload);

        // (1) Secrecy: the sentinel secret value never survives serialization.
        expect(JSON.stringify(r)).not.toContain(secretSentinel);

        // Every secret-named key's value in the result is exactly the placeholder.
        const secretValues: unknown[] = [];
        collectSecretKeyValues(r, secretValues);
        expect(secretValues.length).toBeGreaterThanOrEqual(1);
        for (const v of secretValues) {
          expect(v).toBe(REDACTION_PLACEHOLDER);
        }

        // (2) Purity: input is unchanged after the call.
        expect(payload).toEqual(before);

        // (3) Preservation: the benign sentinel (under a non-secret key) survives.
        expect(containsValue(r, benignSentinel)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
