// Feature: user-registration-backend, Property 8: Access token expiry is always issuance + 900s
/**
 * Property-based test for access-token expiry math.
 *
 * Design reference: `design.md` -> "Property 8: Access token expiry is always
 * issuance + 900s". For any `userId`, any issuance instant (injected via the
 * `now` clock), and any reasonable access TTL, a freshly issued access token
 * must decode to claims where:
 *
 *  - `iat === floor(now / 1000)` (issuance timestamp in whole seconds), and
 *  - `exp - iat === accessTtlSeconds` (default 900s; Req 3.2, 4.1).
 *
 * The `now` clock is injected via {@link createTokenManager} as a closure over a
 * generated epoch-millisecond timestamp, so the invariant holds deterministically
 * without any wall-clock dependency. Tokens are decoded (not verified) with
 * `jwt.decode` so we read exactly the claims that were signed.
 *
 * The global fast-check config (see `src/test/setup.ts`) runs a minimum of 100
 * iterations per property.
 *
 * Validates: Requirements 3.2, 4.1
 */
import fc from 'fast-check';
import jwt from 'jsonwebtoken';
import { createTokenManager } from './tokenManager';

// A fixed, sufficiently-long signing key. No environment or datastore needed:
// this property only exercises access-token issuance, which is pure JWT signing.
const SIGNING_KEY = 'x'.repeat(40);

// The default access-token TTL (900s) plus a spread of other reasonable TTLs to
// prove the invariant is `exp - iat === accessTtlSeconds` for any configured TTL.
const ttlArb = fc.oneof(
  fc.constant(900), // the contract default (Req 3.2, 4.1)
  fc.integer({ min: 1, max: 86_400 }), // any reasonable positive TTL
);

// Epoch milliseconds across realistic wall-clock values (>= 2001-09) up to a
// far-future bound. Constrained away from the epoch-0 boundary because
// `jsonwebtoken` treats a falsy `iat` (0 seconds) as "use the real clock",
// which only occurs for issuance instants under 1000ms and never for a real
// `Date.now()`. The `exp - iat === ttl` invariant holds regardless; this bound
// keeps the `iat === floor(now/1000)` assertion meaningful for realistic clocks.
const nowMsArb = fc.integer({ min: 1_000_000_000_000, max: 2 ** 43 });

describe('createTokenManager.issueAccessToken - Property 8: expiry is issuance + TTL', () => {
  it('issues a token whose decoded exp - iat equals the TTL and iat equals floor(now/1000) (Req 3.2, 4.1)', () => {
    fc.assert(
      fc.property(fc.string(), nowMsArb, ttlArb, (userId, nowMs, accessTtlSeconds) => {
        const manager = createTokenManager({
          signingKey: SIGNING_KEY,
          accessTtlSeconds,
          // Inject a fixed clock via a closure over the generated timestamp.
          now: () => nowMs,
        });

        const token = manager.issueAccessToken(userId);

        // Decode (do not verify) to read the exact signed claims.
        const decoded = jwt.decode(token, { json: true });

        expect(decoded).not.toBeNull();
        if (decoded === null) {
          return;
        }

        const iat = decoded.iat as number;
        const exp = decoded.exp as number;

        expect(iat).toBe(Math.floor(nowMs / 1000));
        expect(exp - iat).toBe(accessTtlSeconds);
        expect(decoded.sub).toBe(userId);
      }),
      { numRuns: 100 },
    );
  });
});
