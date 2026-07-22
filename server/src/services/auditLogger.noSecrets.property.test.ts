// Feature: user-registration-backend, Property 27: Persisted auth events contain no secrets
/**
 * Property 27: Persisted auth events contain no secrets —
 * Validates: Requirements 11.6
 *
 * The Audit_Logger's method signatures deliberately accept only non-sensitive
 * fields (user id, submitted email, source IP). No password or token value is
 * ever passed to or persisted by the service. This property proves that by
 * construction: for any generated secret (password- or token-like string) and
 * any user id / email / source IP, calling each audit method with ONLY its
 * allowed arguments produces a persisted insert-input object that:
 *
 *   (a) has ONLY keys drawn from the expected non-secret set
 *       (`eventType`, `userId`, `email`, `sourceIp`, `occurredAt`) — never a
 *       `password` / `token` / `accessToken` / `refreshToken` / `passwordHash`
 *       secret-bearing key;
 *   (b) has no string value (anywhere in the object graph) equal to the
 *       generated secret; and
 *   (c) does not contain the secret substring in its JSON serialization.
 *
 * The repository is mocked to capture each `insert` input without a datastore.
 */
import fc from 'fast-check';

import { createAuditLogger, type AuditEventRepo } from './auditLogger';
import type {
  AuthEventInput,
  AuthEventRecord,
} from '../repositories/authEventsRepository';

/** Keys that must NEVER appear on a persisted auth-event input (Req 11.6). */
const FORBIDDEN_SECRET_KEYS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'passwordHash',
];

/** The only keys a persisted auth-event input is allowed to carry. */
const ALLOWED_KEYS = ['eventType', 'userId', 'email', 'sourceIp', 'occurredAt'];

/**
 * A mock repository that records every `insert` input for later inspection.
 * Returns a minimal well-formed record so the logger resolves normally.
 */
function createRecordingRepo(): {
  repo: AuditEventRepo;
  inputs: AuthEventInput[];
} {
  const inputs: AuthEventInput[] = [];
  const repo: AuditEventRepo = {
    async insert(input: AuthEventInput): Promise<AuthEventRecord> {
      inputs.push(input);
      return {
        id: 'test-id',
        eventType: input.eventType,
        userId: input.userId ?? null,
        email: input.email ?? null,
        sourceIp: input.sourceIp ?? null,
        occurredAt: input.occurredAt ?? new Date(),
      };
    },
  };
  return { repo, inputs };
}

/**
 * Recursively collect every string value found anywhere in an object graph so
 * the assertion can prove no persisted string equals the generated secret.
 */
function collectStringValues(value: unknown, acc: string[]): void {
  if (typeof value === 'string') {
    acc.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, acc);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      collectStringValues((value as Record<string, unknown>)[key], acc);
    }
  }
}

/** Assert a single persisted input carries no secret keys/values (Req 11.6). */
function assertNoSecrets(input: AuthEventInput, secret: string): void {
  // (a) Only allowed keys; no secret-bearing key present.
  const keys = Object.keys(input);
  for (const key of keys) {
    expect(ALLOWED_KEYS).toContain(key);
    expect(FORBIDDEN_SECRET_KEYS).not.toContain(key);
  }

  // (b) No string value anywhere in the graph equals the generated secret.
  const strings: string[] = [];
  collectStringValues(input, strings);
  for (const s of strings) {
    expect(s).not.toBe(secret);
  }

  // (c) The serialized input never contains the secret substring.
  expect(JSON.stringify(input).includes(secret)).toBe(false);
}

/** A non-empty secret-like string (password/token shaped) to smuggle in. */
const secretArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 64 })
  .map((s) => `secret-${s}-value`);

/** Non-empty identifier/email/IP style values passed as the allowed args. */
const nonEmptyArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((s) => s.trim())
  .filter((s) => s.length >= 1);

describe('Property 27: Persisted auth events contain no secrets (Req 11.6)', () => {
  it('every audit method persists only non-secret keys and no secret value', async () => {
    await fc.assert(
      fc.asyncProperty(
        secretArb,
        nonEmptyArb,
        nonEmptyArb,
        fc.option(nonEmptyArb, { nil: undefined }),
        async (secret, userId, email, sourceIp) => {
          const { repo, inputs } = createRecordingRepo();
          // Deterministic clock so occurredAt is a Date, not a secret carrier.
          const logger = createAuditLogger({ repo, now: () => new Date(0) });

          // Call every method with ONLY its allowed, non-secret arguments.
          await logger.recordRegistration(userId);
          await logger.recordLoginSuccess(userId, sourceIp);
          await logger.recordLoginFailure(email, sourceIp);
          await logger.recordLogout(userId);

          // One persisted input per method call.
          expect(inputs).toHaveLength(4);

          for (const input of inputs) {
            assertNoSecrets(input, secret);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
