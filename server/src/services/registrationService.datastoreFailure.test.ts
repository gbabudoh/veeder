/**
 * Unit tests (example-based) for datastore-failure handling in the
 * Registration_Service.
 *
 * Design reference: `design.md` -> "Services" (Registration_Service) and
 * "Transactional Integrity".
 *
 * The service inserts the user and its `registration` auth event inside a
 * single database transaction. If a repository insert throws a *non-unique*
 * error, that error must propagate out of the transaction (which rolls back)
 * and surface as a 500 via the centralized error handler -- the service does
 * NOT swallow it and leaves no partial state. A unique-constraint violation is
 * instead mapped to a {@link ConflictError} (409).
 *
 * These are plain Jest example tests (no fast-check, no database): the Knex
 * instance, repositories, and hasher are all faked. The fake `transaction(cb)`
 * simply executes `cb(dummyTrx)` and lets thrown errors reject the returned
 * promise -- modelling rollback + propagation without a real datastore.
 *
 * Validates: Requirements 1.8, 9.3
 */
import type { Knex } from 'knex';
import {
  createRegistrationService,
  type RegistrationUsersRepo,
  type RegistrationHasher,
  type RegistrationAuthEventsRepo,
  type RegistrationKnex,
} from './registrationService';
import type { NewUserInput, UserRecord } from '../repositories/usersRepository';
import type { AuthEventInput, AuthEventRecord } from '../repositories/authEventsRepository';
import { ConflictError } from '../errors';

/** A valid registration body: valid email + password within 8..128 chars. */
const validBody = { email: 'user@example.com', password: 'correct horse' };

/** A fake transaction handle -- opaque to the service; only identity matters. */
const dummyTrx = {} as Knex.Transaction;

/**
 * A fake Knex whose `transaction(cb)` runs the callback with {@link dummyTrx}
 * and PROPAGATES anything the callback throws (i.e. the returned promise
 * rejects). This models a rollback-on-error transaction without a database.
 */
const fakeKnex: RegistrationKnex = {
  transaction: async (cb) => cb(dummyTrx),
};

/** A fake argon2id hasher: deterministic and synchronous-enough for tests. */
const fakeHasher: RegistrationHasher = {
  hash: async (p: string) => `h:${p}`,
};

/**
 * Build a fake users repository backed by an in-memory store, whose `insert`
 * behaviour is supplied by the test. `findByEmail` always reports "not found"
 * so the friendly duplicate pre-check passes and we exercise the insert path.
 */
function makeUsersRepo(options: {
  insert: (input: NewUserInput) => Promise<UserRecord>;
  isUniqueViolation: (error: unknown) => boolean;
}): { repo: RegistrationUsersRepo; store: UserRecord[] } {
  const store: UserRecord[] = [];
  const repo: RegistrationUsersRepo = {
    findByEmail: async () => null,
    insert: async (input) => options.insert(input),
    isUniqueViolation: options.isUniqueViolation,
  };
  return { repo, store };
}

describe('createRegistrationService - datastore failure during registration (Req 1.8, 9.3)', () => {
  it('case 1: a non-unique users.insert error propagates (not ConflictError) and leaves no partial state', async () => {
    const dbDown = new Error('db down');
    const { repo: usersRepo, store } = makeUsersRepo({
      // Generic failure: nothing is persisted to the store.
      insert: async () => {
        throw dbDown;
      },
      isUniqueViolation: () => false,
    });

    const authInsert = jest.fn<Promise<AuthEventRecord>, [AuthEventInput]>();
    const authEventsRepo = { insert: authInsert } as unknown as RegistrationAuthEventsRepo;

    const service = createRegistrationService({
      usersRepo,
      hasher: fakeHasher,
      authEventsRepo,
      knex: fakeKnex,
    });

    // The original error propagates unchanged (surfaces as 500 downstream)...
    await expect(service.register(validBody)).rejects.toBe(dbDown);
    // ...and is NOT re-mapped to a ConflictError.
    await expect(service.register(validBody)).rejects.not.toBeInstanceOf(ConflictError);

    // No partial state: no user persisted and the auth event was never written.
    expect(store).toHaveLength(0);
    expect(authInsert).not.toHaveBeenCalled();
  });

  it('case 2 (contrast): a unique-violation users.insert error is mapped to ConflictError (409)', async () => {
    const uniqueViolation = { code: '23505' };
    const { repo: usersRepo, store } = makeUsersRepo({
      insert: async () => {
        throw uniqueViolation;
      },
      isUniqueViolation: (error) =>
        typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505',
    });

    const authInsert = jest.fn<Promise<AuthEventRecord>, [AuthEventInput]>();
    const authEventsRepo = { insert: authInsert } as unknown as RegistrationAuthEventsRepo;

    const service = createRegistrationService({
      usersRepo,
      hasher: fakeHasher,
      authEventsRepo,
      knex: fakeKnex,
    });

    const error = await service.register(validBody).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).status).toBe(409);

    // Still no partial state and no auth event.
    expect(store).toHaveLength(0);
    expect(authInsert).not.toHaveBeenCalled();
  });

  it('case 3: an authEvents.insert error after a successful user insert propagates (rollback, not swallowed)', async () => {
    const insertedUser: UserRecord = {
      id: 'user-1',
      email: validBody.email,
      passwordHash: `h:${validBody.password}`,
      role: 'user',
      createdAt: new Date(0),
    };

    const { repo: usersRepo, store } = makeUsersRepo({
      insert: async (input) => {
        const record: UserRecord = {
          id: insertedUser.id,
          email: input.email,
          passwordHash: input.passwordHash,
          role: 'user',
          createdAt: new Date(0),
        };
        store.push(record);
        return record;
      },
      isUniqueViolation: () => false,
    });

    const auditFailure = new Error('auth_events insert failed');
    const authInsert = jest
      .fn<Promise<AuthEventRecord>, [AuthEventInput]>()
      .mockRejectedValue(auditFailure);
    const authEventsRepo = { insert: authInsert } as unknown as RegistrationAuthEventsRepo;

    const service = createRegistrationService({
      usersRepo,
      hasher: fakeHasher,
      authEventsRepo,
      knex: fakeKnex,
    });

    // The audit-event failure propagates out of the transaction (rollback):
    // the service does NOT swallow it.
    await expect(service.register(validBody)).rejects.toBe(auditFailure);
    await expect(service.register(validBody)).rejects.not.toBeInstanceOf(ConflictError);

    // The user insert was attempted inside the transaction before the event
    // insert failed (the propagation is what triggers the real rollback).
    expect(authInsert).toHaveBeenCalled();
  });
});
