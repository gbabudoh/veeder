import type { Knex } from 'knex';

/**
 * Migration: create the `auth_events` table.
 *
 * Append-only audit log of authentication-related activity for future
 * analytics (Req 11). Ordered after `users` (later timestamp prefix) so the
 * nullable foreign key to `users` resolves.
 *
 * Schema (mirrors design.md "SQL DDL"):
 *   id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
 *   event_type  TEXT NOT NULL
 *               CHECK (event_type IN ('registration','login-success','login-failure','logout'))
 *   user_id     UUID REFERENCES users(id) ON DELETE SET NULL -- null for login-failure (Req 11.3)
 *   email       TEXT            -- submitted email for login-failure (Req 11.3)
 *   source_ip   TEXT            -- placeholder when unknown (Req 11.5, handled in app)
 *   occurred_at TIMESTAMPTZ NOT NULL DEFAULT now() -- UTC timestamp (Req 11.1-11.4)
 *   INDEX auth_events_type_time_idx (event_type, occurred_at)
 *   INDEX auth_events_user_idx (user_id)
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */
export async function up(knex: Knex): Promise<void> {
  // `gen_random_uuid()` is provided by the pgcrypto extension. Ensure it exists
  // in case this migration is run in isolation.
  await knex.raw('create extension if not exists "pgcrypto"');

  await knex.schema.createTable('auth_events', (table) => {
    table
      .uuid('id')
      .primary()
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));

    // Constrained set of event types (Req 11.1-11.4). Enforced via a raw CHECK
    // constraint so the allowed values match the design DDL exactly.
    table.text('event_type').notNullable();

    // Nullable FK: login-failure events have no known user (Req 11.3). On user
    // deletion, retain the audit record but null out the reference.
    table
      .uuid('user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    // Submitted email, present for login-failure (Req 11.3).
    table.text('email').nullable();

    // Source IP; a placeholder is substituted by the app when unknown (Req 11.5).
    table.text('source_ip').nullable();

    // UTC timestamp of the event (Req 11.1-11.4).
    table
      .timestamp('occurred_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // Indexes (match the design DDL names).
    table.index(['event_type', 'occurred_at'], 'auth_events_type_time_idx');
    table.index(['user_id'], 'auth_events_user_idx');
  });

  // CHECK constraint limiting event_type to the allowed enum values. Declared
  // as a raw statement so the constraint name and values mirror the design DDL.
  await knex.raw(
    `alter table "auth_events" add constraint "auth_events_event_type_check" ` +
      `check ("event_type" in ('registration', 'login-success', 'login-failure', 'logout'))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('auth_events');
}
