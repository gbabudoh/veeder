// Feature: user-registration-backend, Property 1: Valid registration creates a retrievable account
/**
 * Property 1: Valid registration creates a retrievable account.
 *
 * Validates: Requirements 1.1, 1.4
 *
 * For any email that satisfies the format/length rules and any password of
 * length 8-128, submitting it to the Registration_Service yields a result
 * carrying the account id and the normalized (trim + lowercase) email, the
 * result never exposes the password hash, and a User_Account with that email is
 * subsequently retrievable by both id and email.
 *
 * This is a pure unit-level property: no database is touched. An in-memory,
 * stateful fake users store (Map-backed) is injected alongside a fake hasher,
 * auth-events repo, and a dummy transaction runner.
 */
import { randomUUID } from 'crypto';
import fc from 'fast-check';
import { createRegistrationService } from './registrationService';
import type {
  NewUserInput,
  UserRecord,
} from '../repositories/usersRepository';
import type {
  AuthEventInput,
  AuthEventRecord,
} from '../repositories/authEventsRepository';

/**
 * Build a fresh set of fakes with an in-memory, stateful users store. The store
 * is indexed by both normalized email and generated id so the service's
 * `findByEmail` / `insert` calls behave like the real repository on the happy
 * path, and the test can retrieve the created account afterward.
 */
function createFakes() {
  const byEmail = new Map<string, UserRecord>();
  const byId = new Map<string, UserRecord>();

  const usersRepo = {
    async findByEmail(email: string): Promise<UserRecord | null> {
      return byEmail.get(email) ?? null;
    },
    async insert(input: NewUserInput): Promise<UserRecord> {
      const record: UserRecord = {
        id: randomUUID(),
        email: input.email,
        passwordHash: input.passwordHash,
        role: 'user',
        createdAt: new Date(),
      };
      byEmail.set(record.email, record);
      byId.set(record.id, record);
      return record;
    },
    // Not exercised on the happy path (no duplicates generated).
    isUniqueViolation: (_error: unknown): boolean => false,
    async findById(id: string): Promise<UserRecord | null> {
      return byId.get(id) ?? null;
    },
  };

  const hasher = {
    hash: async (plainPassword: string): Promise<string> => `hashed:${plainPassword}`,
  };

  const authEventsRepo = {
    insert: async (input: AuthEventInput): Promise<AuthEventRecord> =>
      ({
        id: randomUUID(),
        ...input,
      }) as AuthEventRecord,
  };

  // Dummy transaction runner: passes a placeholder trx the fakes ignore.
  const knex = {
    transaction: async <T>(cb: (trx: any) => Promise<T>): Promise<T> => cb({} as any),
  };

  return { usersRepo, hasher, authEventsRepo, knex };
}

// Alphanumeric characters used to build safe email labels.
const emailChar = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split(''),
);

// A DNS-like label: 1-12 alphanumeric characters.
const label = fc
  .array(emailChar, { minLength: 1, maxLength: 12 })
  .map((chars) => chars.join(''));

// A top-level domain: 2-6 alphabetic characters.
const tld = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
    minLength: 2,
    maxLength: 6,
  })
  .map((chars) => chars.join(''));

/**
 * A valid registration email in a possibly non-normalized display form: a
 * random mix of upper/lower case plus optional surrounding whitespace. The
 * normalized identity is always `display.trim().toLowerCase()`.
 */
const displayEmail = fc
  .record({
    local: label,
    domain: label,
    top: tld,
    upperMask: fc.array(fc.boolean(), { minLength: 0, maxLength: 40 }),
    leadingWs: fc.stringOf(fc.constantFrom(' ', '\t'), { maxLength: 3 }),
    trailingWs: fc.stringOf(fc.constantFrom(' ', '\t'), { maxLength: 3 }),
  })
  .map(({ local, domain, top, upperMask, leadingWs, trailingWs }) => {
    const core = `${local}@${domain}.${top}`;
    const cased = core
      .split('')
      .map((ch, i) => (upperMask[i] ? ch.toUpperCase() : ch))
      .join('');
    return `${leadingWs}${cased}${trailingWs}`;
  });

// A valid password: 8-128 characters with at least one non-whitespace char.
const validPassword = fc
  .string({ minLength: 8, maxLength: 128 })
  .filter((p) => p.trim().length > 0 && p.length >= 8 && p.length <= 128);

describe('Registration_Service - Property 1: valid registration creates a retrievable account', () => {
  it('creates an account that is retrievable by id and email, exposing no password hash', async () => {
    await fc.assert(
      fc.asyncProperty(displayEmail, validPassword, async (rawEmail, password) => {
        const { usersRepo, hasher, authEventsRepo, knex } = createFakes();
        const service = createRegistrationService({
          usersRepo,
          hasher,
          authEventsRepo,
          knex,
        });

        const normalizedEmail = rawEmail.trim().toLowerCase();

        const result = await service.register({ email: rawEmail, password });

        // The result carries a non-empty id and the normalized email (Req 1.4).
        expect(typeof result.id).toBe('string');
        expect(result.id.length).toBeGreaterThan(0);
        expect(result.email).toBe(normalizedEmail);

        // The password hash is never present in the result body (Req 1.4/1.6).
        expect(Object.prototype.hasOwnProperty.call(result, 'passwordHash')).toBe(false);

        // The account is subsequently retrievable by id and by email (Req 1.1).
        const byId = await usersRepo.findById(result.id);
        expect(byId).not.toBeNull();
        expect(byId?.email).toBe(result.email);

        const byEmail = await usersRepo.findByEmail(result.email);
        expect(byEmail).not.toBeNull();
        expect(byEmail?.email).toBe(result.email);
      }),
    );
  });
});
