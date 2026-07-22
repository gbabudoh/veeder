import type { Knex } from 'knex';
import { knex as sharedKnex } from '../db/knex';
import { validateRegistration } from '../validation';
import { passwordHasher } from '../security/passwordHasher';
import {
  usersRepository,
  type NewUserInput,
  type UserRecord,
} from '../repositories/usersRepository';
import {
  authEventsRepository,
  type AuthEventInput,
  type AuthEventRecord,
} from '../repositories/authEventsRepository';
import { ConflictError, ValidationError } from '../errors';

/**
 * Registration_Service.
 *
 * Design reference: `design.md` → "Services" (Registration_Service) and
 * "Transactional Integrity".
 *
 * Orchestrates new account creation end-to-end:
 *
 * 1. Validate the raw request body; on failure throw a {@link ValidationError}
 *    carrying one field entry per failed field (→ 400, Req 1.7, 2.x).
 * 2. Normalize the email (trim + lowercase) — done by the validator — and use
 *    that normalized value for uniqueness and persistence (Req 2.6).
 * 3. Hash the password with argon2id before any persistence (Req 1.2, 1.3).
 * 4. Inside a single database transaction, insert the user AND the
 *    `registration` auth event so the two commit or roll back together; a
 *    persistence failure therefore leaves no partial user (Req 1.8, 9.3, 11.1).
 * 5. Return only the account id and normalized email — never the password hash
 *    (Req 1.4, 1.6).
 *
 * Error mapping:
 * - Duplicate email → {@link ConflictError} (→ 409, Req 1.5), detected either by
 *   a friendly pre-check (`findByEmail`) or by catching the unique-constraint
 *   violation raised by the insert (race-safe).
 * - Any other datastore/persistence failure propagates out of the transaction
 *   (which rolls back) and surfaces as a 500 via the centralized error handler
 *   (Req 1.8, 9.3).
 *
 * The `registration` auth event is written with {@link AuthEventsRepository}
 * directly inside the transaction — NOT via the retrying, non-blocking
 * {@link auditLogger}, whose semantics are for post-hoc logging that must never
 * interrupt the caller. Here atomicity is required (Req 11.1), so the event
 * insert participates in the same transaction and a failure rolls back the user.
 */

/** The public result of a successful registration (Req 1.4, 1.6). */
export interface RegistrationResult {
  id: string;
  email: string;
}

/** Minimal shape of the users repository the service depends on. */
export interface RegistrationUsersRepo {
  findByEmail(email: string, trx?: Knex.Transaction): Promise<UserRecord | null>;
  insert(input: NewUserInput, trx?: Knex.Transaction): Promise<UserRecord>;
  isUniqueViolation(error: unknown): boolean;
}

/** Minimal shape of the password hasher the service depends on. */
export interface RegistrationHasher {
  hash(plainPassword: string): Promise<string>;
}

/** Minimal shape of the auth-events repository the service depends on. */
export interface RegistrationAuthEventsRepo {
  insert(input: AuthEventInput, trx?: Knex.Transaction): Promise<AuthEventRecord>;
}

/** Minimal shape of the Knex instance the service depends on (transactions). */
export interface RegistrationKnex {
  transaction<T>(handler: (trx: Knex.Transaction) => Promise<T>): Promise<T>;
}

/** Dependencies for {@link createRegistrationService}. All optional/defaulted. */
export interface RegistrationServiceDeps {
  usersRepo?: RegistrationUsersRepo;
  hasher?: RegistrationHasher;
  authEventsRepo?: RegistrationAuthEventsRepo;
  knex?: RegistrationKnex;
}

/** The Registration_Service surface. */
export interface RegistrationService {
  /**
   * Register a new account from a raw, untrusted request body.
   *
   * @throws {ValidationError} when the body fails validation (→ 400).
   * @throws {ConflictError} when the (normalized) email already exists (→ 409).
   * @returns The created account id and normalized email.
   */
  register(body: unknown): Promise<RegistrationResult>;
}

/**
 * Create a Registration_Service bound to the given (optional) dependencies.
 *
 * With no arguments it wires the real users repository, argon2id hasher,
 * auth-events repository, and shared Knex instance. Injecting fakes makes the
 * service fully unit-testable without a datastore.
 */
export function createRegistrationService(
  deps: RegistrationServiceDeps = {},
): RegistrationService {
  const usersRepo = deps.usersRepo ?? usersRepository;
  const hasher = deps.hasher ?? passwordHasher;
  const authEventsRepo = deps.authEventsRepo ?? authEventsRepository;
  const db = deps.knex ?? sharedKnex;

  async function register(body: unknown): Promise<RegistrationResult> {
    // 1. Validate + normalize (email trimmed + lowercased by the validator).
    const validation = validateRegistration(body);
    if (!validation.ok) {
      throw new ValidationError(validation.fields);
    }
    const { email, password } = validation.value;

    // 2. Hash the password before any persistence (Req 1.2, 1.3). The plaintext
    //    is never stored or logged.
    const passwordHash = await hasher.hash(password);

    // 3. Insert the user and its `registration` auth event atomically. A failure
    //    anywhere rolls back the whole transaction, leaving no partial user
    //    (Req 1.8, 9.3, 11.1).
    const user = await db.transaction<UserRecord>(async (trx) => {
      // Friendly pre-check for a duplicate so the common case yields a clear
      // 409 without relying on the unique-constraint error (Req 1.5).
      const existing = await usersRepo.findByEmail(email, trx);
      if (existing) {
        throw new ConflictError();
      }

      let created: UserRecord;
      try {
        created = await usersRepo.insert({ email, passwordHash }, trx);
      } catch (error) {
        // Race-safe duplicate handling: a concurrent insert may win between the
        // pre-check and this insert, surfacing as a unique-constraint violation
        // (Req 1.5). Any other error propagates and rolls back → 500 (Req 1.8).
        if (usersRepo.isUniqueViolation(error)) {
          throw new ConflictError();
        }
        throw error;
      }

      // Record the registration auth event in the SAME transaction (Req 11.1)
      // so a rollback leaves no partial state. No secrets/tokens are included
      // (Req 11.6).
      await authEventsRepo.insert(
        { eventType: 'registration', userId: created.id, occurredAt: new Date() },
        trx,
      );

      return created;
    });

    // 4. Return only id + normalized email; the password hash is excluded
    //    (Req 1.4, 1.6).
    return { id: user.id, email: user.email };
  }

  return { register };
}

/**
 * Default Registration_Service instance wired to the real modules. Controllers
 * import this for production use; tests should prefer
 * {@link createRegistrationService} with injected fakes.
 */
export const registrationService = createRegistrationService();

export default createRegistrationService;
