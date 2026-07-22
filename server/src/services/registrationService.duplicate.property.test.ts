// Feature: user-registration-backend, Property 6: Duplicate registration is rejected without disclosure
/**
 * Property-based test for non-disclosing duplicate-registration rejection.
 *
 * Design reference: `design.md` -> "Property 6: Duplicate registration is
 * rejected without disclosure". Requirement 1.5 requires that registering an
 * email that already exists is rejected with a `409` conflict whose response
 * does NOT reveal whether the supplied password matched the existing account.
 *
 * Strategy (no database): the {@link createRegistrationService} factory is wired
 * with lightweight in-memory fakes so the pure orchestration logic can be
 * exercised across many inputs:
 *   - `usersRepo`  : a Map keyed by (normalized) email; `findByEmail` reads it,
 *                    `insert` writes it and rejects real duplicate inserts.
 *   - `hasher`     : a deterministic fake hash (no argon2id cost in tests).
 *   - `authEventsRepo` : records every `insert` call so we can assert the
 *                    duplicate pre-check throws BEFORE any event is written.
 *   - `knex`       : `transaction(cb) => cb({})` runs the handler with a stub trx.
 *
 * For any valid email we register once (must succeed), then attempt to register
 * the SAME email a second time with (a) a DIFFERENT password and (b) the SAME
 * password. Both attempts must reject with a {@link ConflictError} (status 409,
 * code 'duplicate_account'), the two thrown errors must be indistinguishable
 * (equal `.message` and `.code`) regardless of whether the password matched, no
 * second user may be inserted, and no auth event may be recorded for the failed
 * attempts.
 *
 * The global fast-check config (see `src/test/setup.ts`) runs a minimum of 100
 * iterations; `numRuns: 100` is also set explicitly here.
 *
 * Validates: Requirements 1.5
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

// Character set for identifier-like, non-whitespace tokens (matches the valid
// generators used elsewhere in the validation property tests).
const TOKEN_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

const token = (minLength: number, maxLength: number) =>
  fc.stringOf(fc.constantFrom(...TOKEN_CHARS), { minLength, maxLength });

// A well-formed `local@domain.tld` address. Case/whitespace do not matter here
// because the service normalizes the email before persistence; we only need a
// value the validator accepts.
const validEmail: fc.Arbitrary<string> = fc
  .record({
    local: token(1, 12),
    domain: token(1, 12),
    tld: token(1, 8),
  })
  .map(({ local, domain, tld }) => `${local}@${domain}.${tld}`);

// A non-whitespace password within the inclusive 8..128 bound the validator
// accepts.
const validPassword: fc.Arbitrary<string> = token(8, 128);

/** Build a fresh set of in-memory fakes for a single property iteration. */
function makeFakes() {
  const store = new Map<string, UserRecord>();
  let idCounter = 0;
  const authEventInserts: AuthEventInput[] = [];

  const usersRepo: RegistrationUsersRepo = {
    async findByEmail(email: string): Promise<UserRecord | null> {
      return store.get(email) ?? null;
    },
    async insert(input: NewUserInput): Promise<UserRecord> {
      if (store.has(input.email)) {
        // Emulate the datastore unique-constraint violation.
        const err = new Error('duplicate key value violates unique constraint');
        (err as { code?: string }).code = '23505';
        throw err;
      }
      const record: UserRecord = {
        id: `user-${idCounter++}`,
        email: input.email,
        passwordHash: input.passwordHash,
        role: 'user',
        createdAt: new Date(),
      };
      store.set(record.email, record);
      return record;
    },
    isUniqueViolation(error: unknown): boolean {
      return (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === '23505'
      );
    },
  };

  const hasher: RegistrationHasher = {
    async hash(plainPassword: string): Promise<string> {
      return `hash::${plainPassword}`;
    },
  };

  const authEventsRepo: RegistrationAuthEventsRepo = {
    async insert(input: AuthEventInput): Promise<AuthEventRecord> {
      authEventInserts.push(input);
      return {
        id: `event-${authEventInserts.length}`,
        eventType: input.eventType,
        userId: input.userId ?? null,
        email: input.email ?? null,
        sourceIp: input.sourceIp ?? null,
        occurredAt: input.occurredAt ?? new Date(),
      };
    },
  };

  const knex: RegistrationKnex = {
    // Run the handler with a stub transaction object.
    transaction<T>(handler: (trx: never) => Promise<T>): Promise<T> {
      return handler({} as never);
    },
  };

  return { store, authEventInserts, usersRepo, hasher, authEventsRepo, knex };
}

describe('Registration_Service - Property 6: duplicate rejected without disclosure', () => {
  it('rejects duplicate registration identically for same vs different password (Req 1.5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        validEmail,
        // Two distinct valid passwords: the first-registered password and a
        // different one used for the "different password" duplicate attempt.
        fc.tuple(validPassword, validPassword).filter(([a, b]) => a !== b),
        async (email, [firstPassword, otherPassword]) => {
          const fakes = makeFakes();
          const service = createRegistrationService({
            usersRepo: fakes.usersRepo,
            hasher: fakes.hasher,
            authEventsRepo: fakes.authEventsRepo,
            knex: fakes.knex,
          });

          // First registration succeeds and creates exactly one account.
          const created = await service.register({ email, password: firstPassword });
          expect(created.email).toBe(email.trim().toLowerCase());
          expect(fakes.store.size).toBe(1);
          const eventsAfterSuccess = fakes.authEventInserts.length;
          expect(eventsAfterSuccess).toBe(1);

          // Duplicate attempt with a DIFFERENT password.
          let diffError: unknown;
          await expect(
            service.register({ email, password: otherPassword }),
          ).rejects.toBeInstanceOf(ConflictError);
          try {
            await service.register({ email, password: otherPassword });
          } catch (e) {
            diffError = e;
          }

          // Duplicate attempt with the SAME password.
          let sameError: unknown;
          await expect(
            service.register({ email, password: firstPassword }),
          ).rejects.toBeInstanceOf(ConflictError);
          try {
            await service.register({ email, password: firstPassword });
          } catch (e) {
            sameError = e;
          }

          const diff = diffError as ConflictError;
          const same = sameError as ConflictError;

          // Both are 409 duplicate_account conflicts.
          for (const err of [diff, same]) {
            expect(err).toBeInstanceOf(ConflictError);
            expect(err.status).toBe(409);
            expect(err.code).toBe('duplicate_account');
          }

          // Non-disclosure: same-password and different-password duplicates are
          // indistinguishable — identical message and code.
          expect(same.message).toBe(diff.message);
          expect(same.code).toBe(diff.code);

          // No second user was inserted by any duplicate attempt.
          expect(fakes.store.size).toBe(1);

          // No auth event recorded for the failed duplicate attempts: the dup
          // pre-check throws before the event insert.
          expect(fakes.authEventInserts.length).toBe(eventsAfterSuccess);
        },
      ),
      { numRuns: 100 },
    );
  });
});
