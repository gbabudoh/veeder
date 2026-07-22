// Feature: user-registration-backend, Property 17: Access token guard classifies every token to exactly one outcome
/**
 * Property-based test for the access-token guard classification.
 *
 * Design reference: `design.md` -> "Property 17: Access token guard classifies
 * every token to exactly one outcome". For any inbound access token value,
 * {@link TokenManager.verifyAccessToken} must return exactly one status from the
 * closed 5-member set — accepted / missing / invalid / expired / malformed
 * (Req 6.1-6.5) — and never throw. The classification is verified against
 * constructed inputs whose correct outcome is known (Req 7.3, 7.4):
 *
 *  - `undefined` / `''` / whitespace-only -> `missing` (Req 6.2)
 *  - a freshly issued, unexpired token    -> `accepted`, echoing the subject
 *    (Req 6.1)
 *  - a token signed with a DIFFERENT key   -> `invalid` (bad signature; Req 6.3)
 *  - a token whose `exp <= now`            -> `expired` (Req 6.4)
 *  - a clearly non-JWT junk string         -> `malformed` or `invalid`, always
 *    within the closed set (Req 6.5)
 *
 * The signing key and clock are injected via {@link createTokenManager}, so the
 * test is pure logic: no environment and no datastore are required. The global
 * fast-check config (see `src/test/setup.ts`) runs a minimum of 100 iterations
 * per property.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 7.3, 7.4
 */
import fc from 'fast-check';
import { createTokenManager, type AccessTokenVerification } from './tokenManager';

/**
 * The closed set of every legal verification outcome. `verifyAccessToken` must
 * always return exactly one of these `status` values.
 */
const CLOSED_STATUS_SET: ReadonlySet<AccessTokenVerification['status']> = new Set([
  'accepted',
  'missing',
  'invalid',
  'expired',
  'malformed',
]);

// A fixed, sufficiently-long signing key for the "happy path" manager. Any
// non-empty string is a valid HS256 key; 40 chars comfortably exceeds the gate.
const SIGNING_KEY = 'x'.repeat(40);

// The contract access-token TTL (900s). Used for the expiry construction.
const ACCESS_TTL_SECONDS = 900;

// User ids: non-empty strings (the subject echoed back on acceptance).
const userIdArb = fc.string({ minLength: 1, maxLength: 64 });

// A fixed instant to anchor issuance/verification clocks (epoch ms). Bounded to
// realistic wall-clock values (>= ~2001-09) because `jsonwebtoken` treats a
// falsy `clockTimestamp` (i.e. 0 seconds) as "use the real clock", which only
// ever occurs at the unrealistic epoch-0 boundary and never for `Date.now()`.
const nowMsArb = fc.integer({ min: 1_000_000_000_000, max: 2 ** 43 });

describe('createTokenManager.verifyAccessToken - Property 17: guard classifies every token to exactly one outcome', () => {
  it('always returns exactly one status from the closed 5-member set for arbitrary token strings (Req 6.1-6.5)', () => {
    const manager = createTokenManager({ signingKey: SIGNING_KEY });

    fc.assert(
      // Cover both a truly-absent token (undefined) and arbitrary strings,
      // including empty/whitespace/junk. None may throw or escape the set.
      fc.property(fc.option(fc.string(), { nil: undefined }), (token) => {
        const result = manager.verifyAccessToken(token);
        expect(CLOSED_STATUS_SET.has(result.status)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("classifies undefined, empty, and whitespace-only tokens as 'missing' (Req 6.2)", () => {
    const manager = createTokenManager({ signingKey: SIGNING_KEY });

    // Whitespace-only strings (including the empty string) plus undefined.
    const whitespaceArb = fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), {
      maxLength: 16,
    });

    fc.assert(
      fc.property(fc.option(whitespaceArb, { nil: undefined }), (token) => {
        const result = manager.verifyAccessToken(token);
        expect(result.status).toBe('missing');
      }),
      { numRuns: 100 },
    );
  });

  it("accepts a freshly issued, unexpired token and echoes the subject as userId (Req 6.1)", () => {
    fc.assert(
      fc.property(userIdArb, nowMsArb, (userId, nowMs) => {
        // Issue and verify with the same key and the same clock instant, so the
        // token is well within its TTL.
        const manager = createTokenManager({
          signingKey: SIGNING_KEY,
          accessTtlSeconds: ACCESS_TTL_SECONDS,
          now: () => nowMs,
        });

        const token = manager.issueAccessToken(userId);
        const result = manager.verifyAccessToken(token);

        expect(result.status).toBe('accepted');
        if (result.status === 'accepted') {
          expect(result.userId).toBe(userId);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("classifies a token signed with a different key as 'invalid' (bad signature; Req 6.3)", () => {
    fc.assert(
      fc.property(
        userIdArb,
        nowMsArb,
        // Two independent >= 32-char keys; constrained to be distinct below.
        fc.string({ minLength: 32, maxLength: 48 }),
        fc.string({ minLength: 32, maxLength: 48 }),
        (userId, nowMs, keyA, keyB) => {
          // Only meaningful when the keys actually differ.
          fc.pre(keyA !== keyB);

          // Issue with keyA at a fixed instant...
          const issuer = createTokenManager({
            signingKey: keyA,
            accessTtlSeconds: ACCESS_TTL_SECONDS,
            now: () => nowMs,
          });
          const token = issuer.issueAccessToken(userId);

          // ...but verify with keyB at the SAME instant, so the only failure is
          // the signature mismatch (not expiry).
          const verifier = createTokenManager({
            signingKey: keyB,
            accessTtlSeconds: ACCESS_TTL_SECONDS,
            now: () => nowMs,
          });
          const result = verifier.verifyAccessToken(token);

          expect(result.status).toBe('invalid');
        },
      ),
      { numRuns: 100 },
    );
  });

  it("classifies a token whose exp is in the past as 'expired' (Req 6.4)", () => {
    fc.assert(
      fc.property(
        userIdArb,
        nowMsArb,
        // Extra seconds past expiry at verification time (>= 1 so exp < now).
        fc.integer({ min: 1, max: 86_400 }),
        (userId, issueMs, extraSeconds) => {
          // Issue with the clock at `issueMs` (exp = floor(issueMs/1000) + TTL).
          const issuer = createTokenManager({
            signingKey: SIGNING_KEY,
            accessTtlSeconds: ACCESS_TTL_SECONDS,
            now: () => issueMs,
          });
          const token = issuer.issueAccessToken(userId);

          // Verify with a clock strictly past expiry so `exp <= now`.
          const verifyMs = issueMs + (ACCESS_TTL_SECONDS + extraSeconds) * 1000;
          const verifier = createTokenManager({
            signingKey: SIGNING_KEY,
            accessTtlSeconds: ACCESS_TTL_SECONDS,
            now: () => verifyMs,
          });
          const result = verifier.verifyAccessToken(token);

          expect(result.status).toBe('expired');
        },
      ),
      { numRuns: 100 },
    );
  });

  it("classifies clearly non-JWT strings within the closed set, preferring 'malformed' (Req 6.5)", () => {
    const manager = createTokenManager({ signingKey: SIGNING_KEY });

    // A JWT is three base64url segments separated by dots. These junk values
    // are not parseable tokens, so they must land in the closed set; genuinely
    // unparseable shapes are classified 'malformed'.
    const junkArb = fc.oneof(
      fc.constant('not.a.jwt'),
      fc.constant('completely-not-a-token'),
      // Random single-segment base64url (no dots) -> unparseable.
      fc.base64String({ minLength: 1, maxLength: 64 }),
      // Arbitrary bytes as a string.
      fc.string({ minLength: 1, maxLength: 64 }),
    );

    fc.assert(
      fc.property(junkArb, (token) => {
        const result = manager.verifyAccessToken(token);
        // Always within the closed set; for non-parseable junk it is a
        // classification failure (never 'accepted').
        expect(CLOSED_STATUS_SET.has(result.status)).toBe(true);
        expect(result.status).not.toBe('accepted');
      }),
      { numRuns: 100 },
    );

    // Deterministic 'jwt malformed'-style input maps to the preferred outcome.
    expect(manager.verifyAccessToken('not.a.jwt').status).toBe('malformed');
  });
});
