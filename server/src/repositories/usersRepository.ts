import type { Knex } from 'knex';
import { knex } from '../db/knex';

/**
 * Users repository.
 *
 * Owns all persistence access to the `users` table and is the boundary at which
 * database `snake_case` columns (`password_hash`, `created_at`) are mapped to
 * the application's `camelCase` {@link UserRecord} shape. No other layer reads
 * the raw table.
 *
 * Design reference: `design.md` → "Repositories". Requirements 1.1, 1.3, 1.5,
 * 7.1, 7.5.
 *
 * Transaction awareness: every function accepts an optional
 * {@link Knex.Transaction}. When supplied it is used as the query builder so the
 * operation participates in the caller's transaction (e.g. registration inserts
 * the user and its auth event atomically); otherwise the shared {@link knex}
 * instance is used.
 *
 * The `password_hash` value is carried on {@link UserRecord} for the service
 * layer (credential verification) but is deliberately excluded from every HTTP
 * response by controllers (Req 1.6, 7.2).
 */

/**
 * A user's authorization role.
 *
 * Persisted in the `users.role` column (added by migration
 * `20250101000004_add_role_to_users`) as `TEXT NOT NULL DEFAULT 'user'` with a
 * CHECK constraint restricting it to exactly these two values (Req 1.1). New
 * accounts default to `'user'` (Req 1.3); an operator promotes an account to
 * `'admin'` via {@link updateRole} (Req 1.5).
 */
export type Role = 'user' | 'admin';

/** The application-facing shape of a persisted user row. */
export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
}

/** Input for creating a new user. Email is expected to be already normalized. */
export interface NewUserInput {
  email: string;
  passwordHash: string;
}

/** The raw `users` row shape as stored in PostgreSQL (snake_case columns). */
interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  created_at: Date;
}

const USERS_TABLE = 'users';

/**
 * The PostgreSQL `unique_violation` SQLSTATE code. Raised when an insert
 * violates the `users_email_unique` index (Req 1.5).
 */
export const PG_UNIQUE_VIOLATION = '23505';

/**
 * Resolve the query builder to use: the supplied transaction when present,
 * otherwise the shared connection.
 */
function queryBuilder(trx?: Knex.Transaction): Knex | Knex.Transaction {
  return trx ?? knex;
}

/** Map a raw snake_case DB row to the camelCase {@link UserRecord}. */
function mapRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
  };
}

/**
 * Detect whether an error is a PostgreSQL unique-constraint violation.
 *
 * The registration service uses this to map a duplicate-email insert to a
 * `409` conflict (Req 1.5). Kept intentionally simple: it inspects the driver's
 * SQLSTATE `code` property.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/**
 * Look up a user by their normalized email.
 *
 * The caller is responsible for normalizing (trim + lowercase) the email before
 * lookup so identity matches the persisted, normalized form (Req 1.5, 2.6).
 *
 * @returns The matching {@link UserRecord}, or `null` when no user has that email.
 */
export async function findByEmail(
  email: string,
  trx?: Knex.Transaction,
): Promise<UserRecord | null> {
  const row = await queryBuilder(trx)<UserRow>(USERS_TABLE)
    .where({ email })
    .first();
  return row ? mapRow(row) : null;
}

/**
 * Look up a user by their id.
 *
 * Used by the profile endpoint / auth guard to resolve the authenticated user
 * (Req 7.1); returns `null` when the account no longer exists so callers can
 * surface a `404` (Req 7.5).
 *
 * @returns The matching {@link UserRecord}, or `null` when no user has that id.
 */
export async function findById(
  id: string,
  trx?: Knex.Transaction,
): Promise<UserRecord | null> {
  const row = await queryBuilder(trx)<UserRow>(USERS_TABLE)
    .where({ id })
    .first();
  return row ? mapRow(row) : null;
}

/**
 * Insert a new user and return the created record.
 *
 * Email uniqueness is enforced by the `users_email_unique` index; a duplicate
 * insert rejects with a PostgreSQL unique-violation error, which this function
 * lets propagate so the registration service can map it to a `409`
 * (Req 1.5). Use {@link isUniqueViolation} to classify the error.
 *
 * @param input Normalized email and the argon2id password hash.
 * @param trx Optional transaction to run the insert within (Req 7.1 atomicity).
 * @returns The persisted {@link UserRecord}, including database-generated `id`
 *   and `created_at`, and the default `role = 'user'`.
 */
export async function insert(
  input: NewUserInput,
  trx?: Knex.Transaction,
): Promise<UserRecord> {
  // The insert deliberately sets only email + password_hash. The `role` column
  // is populated by its database default (`'user'`), so new accounts registered
  // this way are assigned the `user` role (Req 1.3). `returning('*')` includes
  // that generated `role`, which the mapper reads onto {@link UserRecord}.
  const [row] = await queryBuilder(trx)<UserRow>(USERS_TABLE)
    .insert({
      email: input.email,
      password_hash: input.passwordHash,
    })
    .returning('*');
  return mapRow(row);
}

/**
 * Update the role of an existing user and return the updated record.
 *
 * Backs the operator-invocable `set-role` CLI (Req 1.5): it persists the new
 * role and returns the refreshed {@link UserRecord} so the caller can report
 * the updated value. When no row matches `id` nothing is written and `null` is
 * returned so the caller can surface a not-found error (Req 1.6).
 *
 * @param id The target user's id.
 * @param role The role to assign (`'user'` or `'admin'`).
 * @param trx Optional transaction to run the update within.
 * @returns The updated {@link UserRecord}, or `null` when no user has that id.
 */
export async function updateRole(
  id: string,
  role: Role,
  trx?: Knex.Transaction,
): Promise<UserRecord | null> {
  const [row] = await queryBuilder(trx)<UserRow>(USERS_TABLE)
    .where({ id })
    .update({ role })
    .returning('*');
  return row ? mapRow(row) : null;
}

export const usersRepository = {
  findByEmail,
  findById,
  insert,
  updateRole,
  isUniqueViolation,
};
