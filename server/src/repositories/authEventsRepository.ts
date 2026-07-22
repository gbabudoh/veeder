import { Knex } from 'knex';
import { knex as sharedKnex } from '../db/knex';

/**
 * AuthEvents_Repository.
 *
 * Persistence boundary for the `auth_events` table (see the
 * `20250101000003_create_auth_events` migration and design.md "SQL DDL").
 *
 * Auth events are the append-only audit trail for security-relevant actions:
 * registration, login success/failure, and logout (Req 11.1–11.4). The audit
 * logger service wraps this repository to add retry and non-blocking failure
 * semantics; this layer is a thin, single-purpose writer.
 *
 * Column mapping (snake_case datastore ↔ camelCase domain) happens exclusively
 * at this boundary via {@link mapRow}, so callers only ever see
 * {@link AuthEventRecord}. Never persist secrets or token values here (Req 11.6);
 * the caller supplies only the non-sensitive fields modeled below.
 *
 * The single writer is transaction-aware: it accepts an optional
 * `trx?: Knex.Transaction` and runs against it when provided, otherwise against
 * the shared Knex instance. This lets services compose the event insert inside
 * a single transaction (e.g. registration inserting the user and its
 * `registration` auth event atomically).
 */

/** Table name constant to avoid stringly-typed drift. */
const TABLE = 'auth_events';

/**
 * The set of recordable auth-event types, mirroring the `event_type` check
 * constraint on the `auth_events` table (Req 11.1–11.4).
 */
export type AuthEventType =
  | 'registration'
  | 'login-success'
  | 'login-failure'
  | 'logout';

/**
 * Input for recording a new auth event.
 *
 * `userId`, `email`, and `sourceIp` are all optional/nullable because not every
 * event has them (e.g. a failed login for an unknown email has no `userId`).
 * When `occurredAt` is omitted the datastore `now()` default is used, so the
 * column is deliberately left unset in that case.
 */
export interface AuthEventInput {
  eventType: AuthEventType;
  userId?: string | null;
  email?: string | null;
  sourceIp?: string | null;
  occurredAt?: Date;
}

/**
 * An auth-event row mapped to camelCase domain fields.
 *
 * Mirrors the `auth_events` columns:
 *   id → id, event_type → eventType, user_id → userId, email → email,
 *   source_ip → sourceIp, occurred_at → occurredAt.
 */
export interface AuthEventRecord {
  id: string;
  eventType: AuthEventType;
  userId: string | null;
  email: string | null;
  sourceIp: string | null;
  occurredAt: Date;
}

/** The raw datastore row shape (snake_case) as returned by Knex/pg. */
interface AuthEventRow {
  id: string;
  event_type: AuthEventType;
  user_id: string | null;
  email: string | null;
  source_ip: string | null;
  occurred_at: Date;
}

/** Map a snake_case datastore row to the camelCase domain record. */
function mapRow(row: AuthEventRow): AuthEventRecord {
  return {
    id: row.id,
    eventType: row.event_type,
    userId: row.user_id,
    email: row.email,
    sourceIp: row.source_ip,
    occurredAt: row.occurred_at,
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
 * Persist a new auth event and return the created record (Req 11.1–11.4).
 *
 * `id` is supplied by the datastore default. When `input.occurredAt` is omitted
 * the `occurred_at` column is left unset so the datastore `now()` default
 * applies; when supplied, the caller's timestamp is used verbatim. Nullable
 * fields (`userId`, `email`, `sourceIp`) default to `null` when not provided.
 *
 * @param input The event type plus any applicable subject/context fields.
 * @param trx Optional transaction to run within (e.g. atomic registration).
 * @returns The persisted {@link AuthEventRecord}, including the generated `id`
 *   and resolved `occurredAt`.
 */
export async function insert(
  input: AuthEventInput,
  trx?: Knex.Transaction,
): Promise<AuthEventRecord> {
  const values: {
    event_type: AuthEventType;
    user_id: string | null;
    email: string | null;
    source_ip: string | null;
    occurred_at?: Date;
  } = {
    event_type: input.eventType,
    user_id: input.userId ?? null,
    email: input.email ?? null,
    source_ip: input.sourceIp ?? null,
  };

  if (input.occurredAt !== undefined) {
    values.occurred_at = input.occurredAt;
  }

  const [row] = await runner(trx)<AuthEventRow>(TABLE)
    .insert(values)
    .returning('*');

  return mapRow(row);
}

export const authEventsRepository = {
  insert,
};
