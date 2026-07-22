import type { Knex } from 'knex';

/**
 * Migration: create the `users` table.
 *
 * Establishes the core account record for the user-registration-backend. This
 * migration is intentionally ordered first (fixed early timestamp prefix) so it
 * runs before `refresh_tokens` and `auth_events`, both of which reference
 * `users` via foreign keys.
 *
 * Schema (mirrors design.md "SQL DDL"):
 *   id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
 *   email         TEXT NOT NULL            -- normalized (trimmed + lowercased)
 *   password_hash TEXT NOT NULL            -- argon2id hash; plaintext never stored (Req 1.3)
 *   created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
 *   UNIQUE INDEX users_email_unique (email) -- Req 1.5, 2.6
 *
 * Requirements: 1.1, 1.3, 1.5, 2.6
 */
export async function up(knex: Knex): Promise<void> {
  // `gen_random_uuid()` is provided by the pgcrypto extension. Ensure it exists
  // before relying on it as the id column default.
  await knex.raw('create extension if not exists "pgcrypto"');

  await knex.schema.createTable('users', (table) => {
    table
      .uuid('id')
      .primary()
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));
    table.text('email').notNullable();
    table.text('password_hash').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // Normalized email is unique (Req 1.5, 2.6). Named to match the design DDL.
    table.unique(['email'], { indexName: 'users_email_unique' });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}
