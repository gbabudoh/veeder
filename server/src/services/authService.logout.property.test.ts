// Feature: user-registration-backend, Property 15: Logout revokes the active token and always returns 200
/**
 * Property 15: Logout revokes the active token and always returns 200.
 *
 * Validates: Requirements 5.1, 5.2, 5.3
 *
 * The Auth_Service `logout` method NEVER throws and returns `void`: whatever the
 * presented refresh token — a currently active token, an already-revoked token,
 * an unknown token, or an absent/malformed body — the call resolves normally so
 * the controller can always respond `200` (Req 5.2, 5.3). Additionally, a
 * currently active token is best-effort revoked and yields a `logout` audit
 * event for its owner (Req 5.1), while non-active / unknown / malformed inputs
 * trigger no owner logout event. Because "always 200" is the visible contract of
 * a method that returns `void` and cannot throw, the property is proven by
 * asserting the promise resolves to `undefined` for EVERY input class — even
 * when the revocation write itself fails.
 *
 * This is a pure unit-level property: no database is touched. `refreshTokensRepo`,
 * `tokenManager`, and `auditLogger` are mocks, and `hashRefreshToken` is injected
 * as a deterministic stub.
 */
import fc from 'fast-check';
import { createAuthService } from './authService';
import type { RefreshTokenRecord } from '../repositories/refreshTokensRepository';

/** The four token classes plus a write-failure variant, exercised per run. */
type TokenClass = 'active' | 'revoked' | 'unknown' | 'malformed';

interface Scenario {
  /** Which input class this run exercises. */
  tokenClass: TokenClass;
  /** The request body handed to `logout`. */
  body: unknown;
  /** The plaintext refresh token (only meaningful for non-malformed classes). */
  token: string;
  /** The owner id returned by an active-token lookup. */
  userId: string;
  /** Whether the (best-effort) revocation write rejects, proving always-200 on write failure. */
  revokeThrows: boolean;
}

// A non-empty opaque token string.
const tokenArb = fc
  .string({ minLength: 1, maxLength: 64 })
  .filter((s) => s.length > 0);

const userIdArb = fc.uuid();

// Malformed / absent bodies: none of these carry a present, non-empty
// `refreshToken` string, so `validateRefresh` fails and logout short-circuits.
const malformedBodyArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant({}),
  fc.record({ refreshToken: fc.constant('') }),
  fc.record({ refreshToken: fc.integer() }),
  fc.record({ refreshToken: fc.constant(null) }),
  fc.array(fc.anything(), { maxLength: 3 }),
  fc.integer(),
  fc.string().map((s) => s), // a bare string is not an object → no refreshToken field
);

const scenarioArb: fc.Arbitrary<Scenario> = fc.oneof(
  // (a) valid active token: findByHash returns an unrevoked record with an owner.
  fc.record({
    tokenClass: fc.constant<TokenClass>('active'),
    token: tokenArb,
    userId: userIdArb,
    revokeThrows: fc.boolean(),
  }).map((r) => ({ ...r, body: { refreshToken: r.token } })),
  // (b) already-revoked token: findByHash returns a revoked record (no active owner).
  fc.record({
    tokenClass: fc.constant<TokenClass>('revoked'),
    token: tokenArb,
    userId: userIdArb,
    revokeThrows: fc.boolean(),
  }).map((r) => ({ ...r, body: { refreshToken: r.token } })),
  // (c) unknown token: findByHash returns null (no active owner).
  fc.record({
    tokenClass: fc.constant<TokenClass>('unknown'),
    token: tokenArb,
    userId: userIdArb,
    revokeThrows: fc.boolean(),
  }).map((r) => ({ ...r, body: { refreshToken: r.token } })),
  // (d) absent/malformed body: validateRefresh fails → total no-op.
  fc.record({
    token: tokenArb,
    userId: userIdArb,
    body: malformedBodyArb,
  }).map((r) => ({
    tokenClass: 'malformed' as TokenClass,
    token: r.token,
    userId: r.userId,
    body: r.body,
    revokeThrows: false,
  })),
);

/** Build a full RefreshTokenRecord for a given owner/revoked state. */
function buildRecord(userId: string, revoked: boolean): RefreshTokenRecord {
  return {
    id: 'rec-id',
    userId,
    familyId: 'fam-id',
    tokenHash: 'unused-hash',
    revoked,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    replacedBy: null,
  };
}

/**
 * Wire an Auth_Service whose dependencies are mocked per the scenario's class.
 * Returns the service alongside the mocks so the test can assert on calls.
 */
function buildService(scenario: Scenario) {
  const hashRefreshToken = (t: string) => `h:${t}`;

  const findByHash = jest.fn(async (_hash: string): Promise<RefreshTokenRecord | null> => {
    switch (scenario.tokenClass) {
      case 'active':
        return buildRecord(scenario.userId, false);
      case 'revoked':
        return buildRecord(scenario.userId, true);
      default:
        return null; // 'unknown' (and unreachable for 'malformed', which never looks up)
    }
  });

  const revokeRefreshToken = jest.fn(async (_token: string): Promise<void> => {
    if (scenario.revokeThrows) {
      throw new Error('revocation write failed');
    }
  });

  const tokenManager = {
    issueAccessToken: jest.fn(),
    issueRefreshToken: jest.fn(),
    revokeRefreshToken,
  };

  const recordLogout = jest.fn(async () => undefined);
  const auditLogger = {
    recordLoginSuccess: jest.fn(async () => undefined),
    recordLoginFailure: jest.fn(async () => undefined),
    recordLogout,
  };

  const authService = createAuthService({
    tokenManager,
    auditLogger,
    refreshTokensRepo: { findByHash },
    hashRefreshToken,
  });

  return { authService, findByHash, revokeRefreshToken, recordLogout, hashRefreshToken };
}

describe('Auth_Service - Property 15: logout revokes the active token and always returns 200', () => {
  it('resolves (never throws) for every input class and revokes/audits only active tokens', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const { authService, revokeRefreshToken, recordLogout } = buildService(scenario);
        const sourceIp = '203.0.113.7';

        // Core invariant (Req 5.2, 5.3): logout resolves to undefined for EVERY
        // class — including on revocation-write failure — so the controller can
        // always respond 200. A void method that cannot reject proves "always 200".
        await expect(authService.logout(scenario.body, { sourceIp })).resolves.toBeUndefined();

        if (scenario.tokenClass === 'malformed') {
          // (d) Absent/malformed body short-circuits before any side effect.
          expect(revokeRefreshToken).not.toHaveBeenCalled();
          expect(recordLogout).not.toHaveBeenCalled();
          return;
        }

        // Non-malformed classes attempt a best-effort revoke of the exact token (Req 5.1).
        expect(revokeRefreshToken).toHaveBeenCalledWith(scenario.token);

        if (scenario.revokeThrows) {
          // The revoke rejection is swallowed and aborts the flow before auditing:
          // no logout event is recorded, yet the call still resolved (asserted above).
          expect(recordLogout).not.toHaveBeenCalled();
          return;
        }

        if (scenario.tokenClass === 'active') {
          // (a) Active token: the owner's logout event is recorded exactly once (Req 5.1).
          expect(recordLogout).toHaveBeenCalledTimes(1);
          expect(recordLogout).toHaveBeenCalledWith(scenario.userId);
        } else {
          // (b) revoked / (c) unknown: no active owner → no logout event recorded.
          expect(recordLogout).not.toHaveBeenCalled();
        }
      }),
      { numRuns: 200 },
    );
  });

  it('still resolves when the revocation write rejects (always-200 on write failure)', async () => {
    const { authService, revokeRefreshToken, recordLogout } = buildService({
      tokenClass: 'active',
      body: { refreshToken: 'tok-abc' },
      token: 'tok-abc',
      userId: '11111111-1111-1111-1111-111111111111',
      revokeThrows: true,
    });

    await expect(
      authService.logout({ refreshToken: 'tok-abc' }, { sourceIp: '198.51.100.1' }),
    ).resolves.toBeUndefined();

    // The write was attempted but its failure was swallowed; no logout event follows.
    expect(revokeRefreshToken).toHaveBeenCalledWith('tok-abc');
    expect(recordLogout).not.toHaveBeenCalled();
  });
});
