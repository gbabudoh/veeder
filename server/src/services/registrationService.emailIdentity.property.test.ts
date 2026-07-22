// Feature: user-registration-backend, Property 5: Email normalization determines identity
/**
 * Property-based test for email-normalization identity in the Registration_Service.
 *
 * Design reference: `design.md` -> "Property 5: Email normalization determines
 * identity". The service normalizes an email (trim + lowercase) BEFORE the
 * uniqueness pre-check and persistence (Req 2.6). Consequently, two request
 * bodies whose emails differ only in letter-casing and/or surrounding
 * whitespace normalize to the SAME value and therefore denote the SAME account:
 * registering the first succeeds and stores the user under the normalized
 * email, while registering a second, differently-cased/spaced variant is
 * rejected as a duplicate with a {@link ConflictError} (409, Req 1.5). A
 * genuinely different email (distinct normalized value) still registers with no
 * false conflict.
 *
 * This test uses NO database. Fakes:
 *   - `usersRepo`: a Map keyed by the (already normalized) email the service
 *     passes to `findByEmail` / `insert`. `insert` throws a synthetic
 *     unique-violation if the key already exists (race-safety path), and
 *     `isUniqueViolation` recognizes it.
 *   - `hasher`: `async (p) => `h:${p}`` — fast and deterministic.
 *   - `authEventsRepo`: records inserts and echoes a record back.
 *   - `knex`: `transaction(cb) => cb({})` — runs the handler with a dummy trx.
 *
 * The global fast-check config (see `src/test/setup.ts`) runs a minimum of 100
 * iterations per property; `numRuns: 100` is also set explicitly below.
 *
 * Validates: Requirements 2.6, 1.5
 */
import fc from 'fast-check';
import {
  createRegistrationService,
  type RegistrationUsersRepo,
  type RegistrationHasher,
  type RegistrationAuthEventsRepo,
  type RegistrationKnex,
} from './registrationService';
import type {
  NewUserInput,
  UserRecord,
} from '../repositories/usersRepository';
import type {
  AuthEventInput,
  AuthEventRecord,
} from '../repositories/authEventsRepository';
import { ConflictError } from '../errors';

/**
 * A synthetic unique-constraint violation error, mirroring the PostgreSQL
 * SQLSTATE `23505` shape that `usersRepository.isUniqueViolation` inspects.
 */
class FakeUniqueViolation extends Error {
  public readonly code = '23505';
  constructor() {
    super('duplicate key value violates unique constraint');
    this.name = 'FakeUniqueViolation';
  }
}

/**
 * Build a Map-backed fake users repository keyed by the normalized email the
 * service passes in (the service normalizes before calling findByEmail/insert).
 */
function makeUsersRepo(): {
  repo: RegistrationUsersRepo;
  store: Map<string, UserRecord>;
} {
  const store = new Map<string, UserRecord>();
  let seq = 0;

  const repo: RegistrationUsersRepo = {
    findByEmail(email: string): Promise<UserRecord | null> {
      return Promise.resolve(store.get(email) ?? null);
    },
    insert(input: NewUserInput): Promise<UserRecord> {
      if (store.has(input.email)) {
        // Emulate the datastore unique-constraint rejection (race-safe path).
        return Promise.reject(new FakeUniqueViolation());
      }
      seq += 1;
      const record: UserRecord = {
        id: `user-${seq}`,
        email: input.email,
        passwordHash: input.passwordHash,
        role: 'user',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      };
      store.set(input.email, record);
      return Promise.resolve(record);
    },
    isUniqueViolation(error: unknown): boolean {
      return (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === '23505'
      );
    },
  };

  return { repo, store };
}

/** Fake password hasher: fast, deterministic, no argon2. */
const hasher: RegistrationHasher = {
  hash(plainPassword: string): Promise<string> {
    return Promise.resolve(`h:${plainPassword}`);
  },
};

/** Fake auth-events repo: records inserts and echoes a record back. */
function makeAuthEventsRepo(): {
  repo: RegistrationAuthEventsRepo;
  captured: AuthEventInput[];
} {
  const captured: AuthEventInput[] = [];
  const repo: RegistrationAuthEventsRepo = {
    insert(input: AuthEventInput): Promise<AuthEventRecord> {
      captured.push(input);
      const record: AuthEventRecord = {
        id: `evt-${captured.length}`,
        eventType: input.eventType,
        userId: input.userId ?? null,
        email: input.email ?? null,
        sourceIp: input.sourceIp ?? null,
        occurredAt: input.occurredAt ?? new Date('2024-01-01T00:00:00.000Z'),
      };
      return Promise.resolve(record);
    },
  };
  return { repo, captured };
}

/** Fake Knex whose transaction simply runs the handler with a dummy trx. */
const knex: RegistrationKnex = {
  transaction<T>(handler: (trx: never) => Promise<T>): Promise<T> {
    // The fakes ignore the trx argument entirely.
    return handler({} as never);
  },
};

function makeService() {
  const { repo: usersRepo, store } = makeUsersRepo();
  const { repo: authEventsRepo } = makeAuthEventsRepo();
  const service = createRegistrationService({
    usersRepo,
    hasher,
    authEventsRepo,
    knex,
  });
  return { service, store };
}

// --- Generators ------------------------------------------------------------

// Base email parts use lowercase letters + digits only (no whitespace, no '@',
// no '.') so the assembled `local@domain.tld` is a valid, already-normalized
// email that the validator accepts (Req 1.1, 2.1).
const BASE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
const basePart = (minLength: number, maxLength: number) =>
  fc.stringOf(fc.constantFrom(...BASE_CHARS), { minLength, maxLength });

/** A base, already-normalized email of the form local@domain.tld. */
const baseEmail = fc
  .tuple(basePart(1, 12), basePart(1, 12), basePart(2, 6))
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

// Whitespace characters that JS `String.prototype.trim()` removes; the service
// normalizes with trim() before validation/persistence.
const WHITESPACE = [' ', '\t'];
const surroundingWhitespace = fc.stringOf(fc.constantFrom(...WHITESPACE), {
  minLength: 0,
  maxLength: 4,
});

/**
 * A "variant spec" describes how to derive a case/whitespace variant of a base
 * email: a non-empty array of booleans driving per-character upper/lower casing
 * (indexed modulo its length) plus leading and trailing whitespace to wrap it.
 */
const variantSpec = fc.record({
  casing: fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }),
  lead: surroundingWhitespace,
  trail: surroundingWhitespace,
});

/**
 * Build a case/whitespace variant of `base` from a spec. Re-casing letters and
 * adding surrounding whitespace does not change the normalized value
 * (trim + lowercase), so every variant of `base` normalizes back to `base`.
 */
function buildVariant(
  base: string,
  spec: { casing: boolean[]; lead: string; trail: string },
): string {
  const cased = base
    .split('')
    .map((ch, i) =>
      spec.casing[i % spec.casing.length] ? ch.toUpperCase() : ch.toLowerCase(),
    )
    .join('');
  return `${spec.lead}${cased}${spec.trail}`;
}

/** The normalized form the service is expected to derive (trim + lowercase). */
function normalize(email: string): string {
  return email.trim().toLowerCase();
}

// A valid password (8..128 chars, not whitespace-only) to satisfy validation.
const password = fc
  .string({ minLength: 8, maxLength: 32 })
  .map((s) => `pw-${s}`.slice(0, 128))
  .filter((s) => s.length >= 8 && s.trim().length > 0);

describe('createRegistrationService - Property 5: email normalization determines identity', () => {
  it('two case/whitespace variants of one email share identity; a distinct email does not conflict', async () => {
    await fc.assert(
      fc.asyncProperty(
        baseEmail,
        baseEmail,
        variantSpec,
        variantSpec,
        password,
        password,
        password,
        async (base1, base2Raw, spec1, spec2, pw1, pw2, pw3) => {
          const normalized1 = normalize(base1);
          // Guarantee the "different" email has a distinct normalized value so
          // it must NOT collide with base1.
          const base2 =
            normalize(base2Raw) === normalized1 ? `z${base2Raw}` : base2Raw;
          const normalized2 = normalize(base2);
          fc.pre(normalized2 !== normalized1);

          const { service, store } = makeService();

          // Two variants of base1 that normalize identically.
          const variantA = buildVariant(base1, spec1);
          const variantB = buildVariant(base1, spec2);

          // 1. Registering the first variant succeeds and stores under the
          //    normalized email; the returned email is exactly the normalized
          //    form (lowercased + trimmed).
          const created = await service.register({
            email: variantA,
            password: pw1,
          });
          expect(created.email).toBe(normalized1);
          expect(store.has(normalized1)).toBe(true);
          expect(store.get(normalized1)?.email).toBe(normalized1);

          // 2. Registering the SECOND variant (same normalized value) is
          //    rejected as a duplicate (Req 1.5) — identity is decided by the
          //    normalized email (Req 2.6).
          await expect(
            service.register({ email: variantB, password: pw2 }),
          ).rejects.toBeInstanceOf(ConflictError);

          // The duplicate attempt must not create a second stored account.
          expect(store.size).toBe(1);

          // 3. A genuinely different email (distinct normalized value) still
          //    registers — no false conflict.
          const other = await service.register({
            email: base2,
            password: pw3,
          });
          expect(other.email).toBe(normalized2);
          expect(store.has(normalized2)).toBe(true);
          expect(store.size).toBe(2);
        },
      ),
      { numRuns: 100 },
    );
  });
});
