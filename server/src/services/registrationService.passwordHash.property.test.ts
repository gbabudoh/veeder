// Feature: user-registration-backend, Property 2: Passwords are stored only as a verifying hash
/**
 * Property-based test for verifying-hash-only password storage.
 *
 * Design reference: `design.md` -> "Property 2: Passwords are stored only as a
 * verifying hash". This test drives {@link createRegistrationService} with the
 * REAL {@link passwordHasher} (argon2id) injected, plus in-memory fakes for the
 * users repository, the auth-events repository, and the Knex transaction
 * boundary (no database). For any valid registration body it captures the
 * `passwordHash` handed to `usersRepo.insert` and asserts that:
 *
 *   1. the stored value is NOT the plaintext password;
 *   2. the stored value is a genuine argon2id hash (`$argon2id$` prefix);
 *   3. verifying the stored hash against the original plaintext succeeds;
 *   4. verifying against a modified plaintext fails; and
 *   5. no field of the persisted user record equals the plaintext password.
 *
 * argon2 is CPU-heavy, so this property runs a reduced iteration count
 * (`numRuns: 20`) and the suite uses a generous 60s Jest timeout.
 *
 * Validates: Requirements 1.2, 1.3
 */
import fc from 'fast-check';
import type { Knex } from 'knex';
import { createRegistrationService } from './registrationService';
import { passwordHasher } from '../security/passwordHasher';
import type {
  NewUserInput,
  UserRecord,
} from '../repositories/usersRepository';
import type {
  AuthEventInput,
  AuthEventRecord,
} from '../repositories/authEventsRepository';

jest.setTimeout(60_000);

// Character set for identifier-like, non-whitespace tokens.
const TOKEN_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

const token = (minLength: number, maxLength: number) =>
  fc.stringOf(fc.constantFrom(...TOKEN_CHARS), { minLength, maxLength });

// A well-formed `local@domain.tld` address (the validator trims + lowercases).
const validEmail: fc.Arbitrary<string> = fc
  .record({
    local: token(1, 12),
    domain: token(1, 12),
    tld: token(1, 8),
  })
  .map(({ local, domain, tld }) => `${local}@${domain}.${tld}`);

// Non-whitespace passwords within the inclusive 8..128 length bound.
const validPassword: fc.Arbitrary<string> = token(8, 128);

const validBody = fc.record({ email: validEmail, password: validPassword });

/**
 * Build a fresh set of in-memory fakes for one registration run. The users
 * repo captures the `passwordHash` and the full record it "persists".
 */
function makeFakes() {
  const captured: { insertedInput?: NewUserInput; storedUser?: UserRecord } = {};

  const usersRepo = {
    async findByEmail(): Promise<UserRecord | null> {
      return null;
    },
    async insert(input: NewUserInput): Promise<UserRecord> {
      captured.insertedInput = input;
      const record: UserRecord = {
        id: 'user-id-fixed',
        email: input.email,
        passwordHash: input.passwordHash,
        role: 'user',
        createdAt: new Date(0),
      };
      captured.storedUser = record;
      return record;
    },
    isUniqueViolation(): boolean {
      return false;
    },
  };

  const authEventsRepo = {
    async insert(input: AuthEventInput): Promise<AuthEventRecord> {
      return {
        id: 'event-id-fixed',
        eventType: input.eventType,
        userId: input.userId ?? null,
        email: input.email ?? null,
        sourceIp: input.sourceIp ?? null,
        occurredAt: input.occurredAt ?? new Date(0),
      };
    },
  };

  const knex = {
    async transaction<T>(
      handler: (trx: Knex.Transaction) => Promise<T>,
    ): Promise<T> {
      return handler({} as Knex.Transaction);
    },
  };

  return { captured, usersRepo, authEventsRepo, knex };
}

describe('registrationService - Property 2: passwords are stored only as a verifying hash', () => {
  it('stores a genuine argon2id hash that verifies the password and never the plaintext (Req 1.2, 1.3)', async () => {
    await fc.assert(
      fc.asyncProperty(validBody, async ({ email, password }) => {
        const { captured, usersRepo, authEventsRepo, knex } = makeFakes();
        const service = createRegistrationService({
          usersRepo,
          hasher: passwordHasher,
          authEventsRepo,
          knex,
        });

        await service.register({ email, password });

        const storedHash = captured.insertedInput?.passwordHash;
        expect(typeof storedHash).toBe('string');
        const hash = storedHash as string;

        // (1) The stored value is not the plaintext password.
        expect(hash).not.toBe(password);

        // (2) The stored value is a genuine argon2id hash.
        expect(hash.startsWith('$argon2id$')).toBe(true);

        // (3) The stored hash verifies against the original plaintext.
        expect(await passwordHasher.verify(hash, password)).toBe(true);

        // (4) The stored hash rejects a modified plaintext.
        expect(await passwordHasher.verify(hash, password + 'x')).toBe(false);

        // (5) No field of the persisted user record equals the plaintext.
        const values = Object.values(captured.storedUser ?? {});
        for (const value of values) {
          expect(value).not.toBe(password);
        }
      }),
      { numRuns: 20 },
    );
  });
});
