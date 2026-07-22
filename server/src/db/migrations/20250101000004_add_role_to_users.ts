import type { Knex } from 'knex';

/**
 * Migration: add a `role` column to the `users` table.
 *
 * Introduces the admin role model on top of the existing authentication
 * foundation. The column is constrained to exactly the two allowed values
 * `user` and `admin`, defaults to `user`, and is enforced by an
 * explicitly-named CHECK constraint so out-of-set values are rejected and the
 * row is not written (Req 1.1).
 *
 * Existing rows are backfilled to `user` by the column default; because the
 * default is applied to every pre-existing row, the count and identity of
 * existing `users` rows are unchanged (Req 1.2).
 *
 * Schema addition (mirrors design.md "Migration" section):
 *   role TEXT NOT NULL DEFAULT 'user'
 *   CONSTRAINT users_role_check CHECK (role IN ('user','admin'))
 *
 * Requirements: 1.1, 1.2, 1.7
 */
export async function up(knex: Knex): Promise<void> {
  // Add the column with a NOT NULL default so existing rows backfill to `user`
  // and their identity/count remain unchanged (Req 1.2).
  await knex.schema.alterTable('users', (table) => {
    table.text('role').notNullable().defaultTo('user');
  });

  // Explicitly-named, portable CHECK constraint restricting the value set to
  // the two allowed roles (Req 1.1). Declared via raw so the constraint name
  // and allowed values mirror the design DDL exactly.
  await knex.raw(
    `alter table "users" add constraint "users_role_check" ` +
      `check ("role" in ('user', 'admin'))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  // Drop the CHECK constraint first (if present) so the column can be removed
  // cleanly, then drop the `role` column, leaving all other `users` columns and
  // their values unchanged (Req 1.7).
  await knex.raw(`alter table "users" drop constraint if exists "users_role_check"`);
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('role');
  });
}
