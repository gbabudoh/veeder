import type { Knex } from 'knex';

/**
 * Migration: create the `refresh_tokens` table.
 *
 * Stores opaque, rotating refresh tokens as one-way hashes (never plaintext,
 * Req 10.3). Tokens are grouped into a rotation lineage via `family_id` so that
 * presenting a previously-rotated token can trigger revocation of the entire
 * family (reuse detection, Req 4.6). This migration is ordered after `users`
 * (timestamp prefix 20250101000002) so the `user_id` foreign key resolves.
 *
 * Schema (mirrors design.md "SQL DDL"):
 *   id           UUID PRIMARY KEY DEFAULT gen_random_uuid()
 *   user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
 *   family_id    UUID NOT NULL                 -- shared across a rotation chain (Req 4.6)
 *   token_hash   TEXT NOT NULL                 -- SHA-256 of opaque token; no plaintext (Req 10.3)
 *   revoked      BOOLEAN NOT NULL DEFAULT FALSE
 *   expires_at   TIMESTAMPTZ NOT NULL          -- created_at + 2,592,000s (Req 3.3, 4.2)
 *   created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
 *   replaced_by  UUID REFERENCES refresh_tokens(id) -- successor after rotation
 *   UNIQUE INDEX refresh_tokens_hash_unique (token_hash)
 *   INDEX refresh_tokens_family_idx (family_id)
 *   INDEX refresh_tokens_user_idx (user_id)
 *
 * Requirements: 3.3, 4.2, 4.6, 10.3
 */
export async function up(knex: Knex): Promise<void> {
  // `gen_random_uuid()` is provided by the pgcrypto extension. The users
  // migration already ensures it exists, but guard here too so this migration
  // is self-contained.
  await knex.raw('create extension if not exists "pgcrypto"');

  await knex.schema.createTable('refresh_tokens', (table) => {
    table
      .uuid('id')
      .primary()
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));

    // FK to the owning user; cascade delete removes tokens when the user is
    // deleted.
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    // Groups a rotation lineage for reuse detection (Req 4.6).
    table.uuid('family_id').notNullable();

    // Only the SHA-256 hash of the opaque token is stored (Req 10.3).
    table.text('token_hash').notNullable();

    table.boolean('revoked').notNullable().defaultTo(false);

    // Set by the app to created_at + 2,592,000s (Req 3.3, 4.2).
    table.timestamp('expires_at', { useTz: true }).notNullable();

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // Points to the successor token id after rotation; nullable self-reference.
    table
      .uuid('replaced_by')
      .nullable()
      .references('id')
      .inTable('refresh_tokens');

    // Token hash lookups must be a single unique indexed match (Req 10.3).
    table.unique(['token_hash'], {
      indexName: 'refresh_tokens_hash_unique',
    });

    // Family-wide revocation on reuse detection (Req 4.6).
    table.index(['family_id'], 'refresh_tokens_family_idx');

    // Per-user token queries.
    table.index(['user_id'], 'refresh_tokens_user_idx');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('refresh_tokens');
}
