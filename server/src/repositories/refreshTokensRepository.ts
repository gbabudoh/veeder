import { Knex } from 'knex';
import { knex as sharedKnex } from '../db/knex';

/**
 * RefreshTokens_Repository.
 *
 * Persistence boundary for the `refresh_tokens` table (see the
 * `20250101000002_create_refresh_tokens` migration and design.md "SQL DDL").
 *
 * Refresh tokens are opaque, high-entropy secrets; only a one-way hash of the
 * token is ever stored here — the plaintext never touches the datastore
 * (Req 10.3). Tokens are grouped into a rotation lineage via `family_id` so a
 * previously-rotated token can trigger revocation of the whole family (reuse
 * detection, Req 4.6).
 *
 * Column mapping (snake_case datastore ↔ camelCase domain) happens exclusively
 * at this boundary via {@link mapRow}, so callers only ever see
 * {@link RefreshTokenRecord}.
 *
 * Every function is transaction-aware: it accepts an optional
 * `trx?: Knex.Transaction` and runs against it when provided, otherwise against
 * the shared Knex instance. This lets services compose repository calls inside
 * a single transaction (e.g. rotation revoking one token and inserting its
 * successor atomically).
 */

/** Table name constant to avoid stringly-typed drift. */
const TABLE = 'refresh_tokens';

/**
 * A refresh-token row mapped to camelCase domain fields.
 *
 * Mirrors the `refresh_tokens` columns:
 *   id → id, user_id → userId, family_id → familyId, token_hash → tokenHash,
 *   revoked → revoked, expires_at → expiresAt, created_at → createdAt,
 *   replaced_by → replacedBy.
 */
export interface RefreshTokenRecord {
  id: string;
  userId: string;
  familyId: string;
  /** SHA-256 hash of the opaque token; never the plaintext (Req 10.3). */
  tokenHash: string;
  revoked: boolean;
  expiresAt: Date;
  createdAt: Date;
  /** Successor token id after rotation, or `null` when not yet rotated. */
  replacedBy: string | null;
}

/** Input required to persist a new refresh token (hash only, Req 10.3). */
export interface InsertRefreshTokenInput {
  userId: string;
  familyId: string;
  /** One-way hash of the opaque token; the plaintext is never stored. */
  tokenHash: string;
  /** Absolute expiry = created_at + 2,592,000s, computed by the caller. */
  expiresAt: Date;
}

/** Options for {@link revokeById}. */
export interface RevokeByIdOptions {
  /**
   * When rotating, set the revoked token's `replaced_by` to the successor's id
   * in the same update so the rotation lineage is linked atomically.
   */
  replacedBy?: string;
}

/** The raw datastore row shape (snake_case) as returned by Knex/pg. */
interface RefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  revoked: boolean;
  expires_at: Date;
  created_at: Date;
  replaced_by: string | null;
}

/** Map a snake_case datastore row to the camelCase domain record. */
function mapRow(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    familyId: row.family_id,
    tokenHash: row.token_hash,
    revoked: row.revoked,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    replacedBy: row.replaced_by,
  };
}

/**
 * Resolve the query runner: prefer the provided transaction, else fall back to
 * the shared Knex instance.
 */
function runner(trx?: Knex.Transaction): Knex | Knex.Transaction {
  return trx ?? sharedKnex;
}

/**
 * Persist a new refresh token, storing only its hash (never plaintext, Req 10.3).
 *
 * `id` and `created_at` are supplied by datastore defaults; the returned record
 * reflects the persisted row (including the generated id and created_at).
 *
 * @param input The owning user, family lineage, token hash, and expiry.
 * @param trx Optional transaction to run within.
 * @returns The persisted {@link RefreshTokenRecord}.
 */
export async function insert(
  input: InsertRefreshTokenInput,
  trx?: Knex.Transaction,
): Promise<RefreshTokenRecord> {
  const [row] = await runner(trx)<RefreshTokenRow>(TABLE)
    .insert({
      user_id: input.userId,
      family_id: input.familyId,
      token_hash: input.tokenHash,
      expires_at: input.expiresAt,
    })
    .returning(['id', 'user_id', 'family_id', 'token_hash', 'revoked', 'expires_at', 'created_at', 'replaced_by']);

  return mapRow(row);
}

/**
 * Look up a refresh token by its stored hash.
 *
 * Verification hashes the presented token and matches it here, so lookups are a
 * single unique-indexed read (`refresh_tokens_hash_unique`).
 *
 * @param tokenHash The one-way hash of the presented token.
 * @param trx Optional transaction to run within.
 * @returns The matching record, or `null` when no row matches.
 */
export async function findByHash(
  tokenHash: string,
  trx?: Knex.Transaction,
): Promise<RefreshTokenRecord | null> {
  const row = await runner(trx)<RefreshTokenRow>(TABLE)
    .where({ token_hash: tokenHash })
    .first();

  return row ? mapRow(row) : null;
}

/**
 * Mark a single refresh token as revoked.
 *
 * When rotating, pass `options.replacedBy` to link the revoked token to its
 * successor in the same update (sets `replaced_by`).
 *
 * Signature: `revokeById(id, options?, trx?)` — the options object carries the
 * optional `replacedBy` successor id; `trx` is the optional transaction.
 *
 * @param id The id of the token to revoke.
 * @param options Optional rotation linkage (`replacedBy`).
 * @param trx Optional transaction to run within.
 */
export async function revokeById(
  id: string,
  options?: RevokeByIdOptions,
  trx?: Knex.Transaction,
): Promise<void> {
  const update: { revoked: boolean; replaced_by?: string } = { revoked: true };
  if (options?.replacedBy !== undefined) {
    update.replaced_by = options.replacedBy;
  }

  await runner(trx)<RefreshTokenRow>(TABLE).where({ id }).update(update);
}

/**
 * Revoke every refresh token sharing a family id (reuse detection, Req 4.6).
 *
 * Presenting a previously-rotated token invalidates the whole rotation lineage,
 * including the most recently issued token.
 *
 * @param familyId The rotation lineage to revoke.
 * @param trx Optional transaction to run within.
 */
export async function revokeFamily(
  familyId: string,
  trx?: Knex.Transaction,
): Promise<void> {
  await runner(trx)<RefreshTokenRow>(TABLE)
    .where({ family_id: familyId })
    .update({ revoked: true });
}

export const refreshTokensRepository = {
  insert,
  findByHash,
  revokeById,
  revokeFamily,
};
