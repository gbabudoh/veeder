import type { Knex } from 'knex';
import { knex } from '../db/knex';
import type { Role } from './usersRepository';

/**
 * Admin repository.
 *
 * Owns every read query the admin API issues against the `users` and
 * `auth_events` tables (user listing/search, single-user activity, the
 * system-wide activity log, and analytics aggregates). It is the boundary at
 * which database `snake_case` columns are mapped to the application's
 * `camelCase` DTO shapes ({@link UserSummary}, {@link ActivityEntry},
 * {@link DailyBucket}).
 *
 * Design reference: `design.md` → "Admin repository — `repositories/adminRepository.ts`".
 * Requirements 4.1, 4.2, 5.2, 6.1, 6.3, 6.4, 7.1, 7.4, 7.5.
 *
 * Security: these queries **never** select `password_hash` or any token/secret
 * column, so those values can never reach an admin response (Req 8.1). Each
 * `SELECT` enumerates only the non-secret columns it needs.
 *
 * Transaction awareness: every function accepts an optional
 * {@link Knex.Transaction}. When supplied it is used as the query builder so the
 * operation participates in the caller's transaction; otherwise the shared
 * {@link knex} instance is used (mirrors the convention in `usersRepository`).
 *
 * Timestamp handling: `Date`/timestamp values read from the datastore are
 * converted to ISO-8601 UTC strings via {@link Date.toISOString} when building
 * DTOs, so every timestamp surfaced by the admin API is a UTC ISO string
 * (Req 5.1, 6.2, 7.5).
 */

/** The four persisted authentication-event types (`auth_events.event_type`). */
export type EventType =
  | 'registration'
  | 'login-success'
  | 'login-failure'
  | 'logout';

/**
 * A closed UTC time window `[start, end]` used to bound activity queries and
 * analytics aggregates (Req 6.4, 7.1). Both bounds are inclusive.
 */
export interface TimeRange {
  start: Date;
  end: Date;
}

/**
 * Optional filters applied to activity-log queries. An absent field imposes no
 * constraint on that dimension (Req 6.3, 6.4).
 */
export interface ActivityFilter {
  eventType?: EventType;
  start?: Date;
  end?: Date;
}

/**
 * A non-secret user summary returned by user list/detail queries. Deliberately
 * excludes `passwordHash` and any token value (Req 4.5, 8.1).
 */
export interface UserSummary {
  id: string;
  email: string;
  role: Role;
  /** ISO-8601 UTC timestamp. */
  createdAt: string;
}

/** A single authentication event as surfaced by the admin API (Req 6.2). */
export interface ActivityEntry {
  id: string;
  eventType: EventType;
  userId: string | null;
  email: string | null;
  sourceIp: string | null;
  /** ISO-8601 UTC timestamp. */
  occurredAt: string;
}

/** A per-day analytics bucket over a {@link TimeRange} (Req 7.5). */
export interface DailyBucket {
  /** ISO-8601 UTC start of the 24-hour interval. */
  intervalStart: string;
  registration: number;
  loginSuccess: number;
  loginFailure: number;
}

const USERS_TABLE = 'users';
const AUTH_EVENTS_TABLE = 'auth_events';

/**
 * Resolve the query builder to use: the supplied transaction when present,
 * otherwise the shared connection.
 */
function queryBuilder(trx?: Knex.Transaction): Knex | Knex.Transaction {
  return trx ?? knex;
}

/** The subset of `users` columns exposed as a summary (never secrets). */
interface UserSummaryRow {
  id: string;
  email: string;
  role: Role;
  created_at: Date;
}

/** The subset of `auth_events` columns exposed by the activity log. */
interface ActivityRow {
  id: string;
  event_type: EventType;
  user_id: string | null;
  email: string | null;
  source_ip: string | null;
  occurred_at: Date;
}

/** Map a raw `users` summary row to the camelCase {@link UserSummary}. */
function mapUserSummary(row: UserSummaryRow): UserSummary {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  };
}

/** Map a raw `auth_events` row to the camelCase {@link ActivityEntry}. */
function mapActivityEntry(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    eventType: row.event_type,
    userId: row.user_id,
    email: row.email,
    sourceIp: row.source_ip,
    occurredAt: row.occurred_at.toISOString(),
  };
}

/**
 * Coerce a driver count value (PostgreSQL `count(*)` returns a `bigint`, which
 * node-postgres surfaces as a string) into a JavaScript number.
 */
function toCount(value: unknown): number {
  return Number(value ?? 0);
}

/**
 * Escape LIKE/ILIKE wildcard metacharacters (`%`, `_`) and the escape
 * character itself in a user-supplied search term, so the term is matched
 * literally as a substring (Req 4.2). The caller wraps the escaped term in
 * `%...%`.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * The non-secret user summary columns to select. Enumerated explicitly so
 * `password_hash` (and any future secret column) is never read (Req 8.1).
 */
const USER_SUMMARY_COLUMNS = ['id', 'email', 'role', 'created_at'] as const;

/** The activity columns to select (no secret columns exist on `auth_events`). */
const ACTIVITY_COLUMNS = [
  'id',
  'event_type',
  'user_id',
  'email',
  'source_ip',
  'occurred_at',
] as const;

/**
 * List a page of user summaries, optionally filtered by a case-insensitive
 * email substring search (Req 4.2). Results are ordered by
 * `created_at DESC, id ASC` for a deterministic, most-recent-first page
 * (Req 4.1).
 */
export async function listUsers(
  f: { search?: string; limit: number; offset: number },
  trx?: Knex.Transaction,
): Promise<UserSummary[]> {
  const query = queryBuilder(trx)<UserSummaryRow>(USERS_TABLE)
    .select(...USER_SUMMARY_COLUMNS)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'asc')
    .limit(f.limit)
    .offset(f.offset);

  if (f.search !== undefined && f.search.length > 0) {
    query.where('email', 'ilike', `%${escapeLike(f.search)}%`);
  }

  const rows = await query;
  return rows.map(mapUserSummary);
}

/**
 * Count the users matching an optional email search, used to compute pagination
 * metadata totals (Req 4.6). Applies the same case-insensitive filter as
 * {@link listUsers} (Req 4.2).
 */
export async function countUsers(
  f: { search?: string },
  trx?: Knex.Transaction,
): Promise<number> {
  const query = queryBuilder(trx)(USERS_TABLE).count<{ count: string }[]>({
    count: '*',
  });

  if (f.search !== undefined && f.search.length > 0) {
    query.where('email', 'ilike', `%${escapeLike(f.search)}%`);
  }

  const [row] = await query;
  return toCount(row?.count);
}

/**
 * Look up a single user summary by id (Req 5.1). Returns `null` when no user
 * has that id so the caller can surface a `404` (Req 5.6).
 */
export async function findUserSummaryById(
  id: string,
  trx?: Knex.Transaction,
): Promise<UserSummary | null> {
  const row = await queryBuilder(trx)<UserSummaryRow>(USERS_TABLE)
    .select(...USER_SUMMARY_COLUMNS)
    .where({ id })
    .first();
  return row ? mapUserSummary(row) : null;
}

/**
 * List a page of a single user's authentication activity, ordered most-recent
 * first with ties broken by descending id (`occurred_at DESC, id DESC`),
 * matching the activity-log ordering (Req 5.2, 6.1).
 */
export async function listUserActivity(
  f: { userId: string; limit: number; offset: number },
  trx?: Knex.Transaction,
): Promise<ActivityEntry[]> {
  const rows = await queryBuilder(trx)<ActivityRow>(AUTH_EVENTS_TABLE)
    .select(...ACTIVITY_COLUMNS)
    .where({ user_id: f.userId })
    .orderBy('occurred_at', 'desc')
    .orderBy('id', 'desc')
    .limit(f.limit)
    .offset(f.offset);
  return rows.map(mapActivityEntry);
}

/**
 * Count a single user's authentication events, used to compute the
 * `activityPagination.total` for the user-detail response (Req 5.2). Applies the
 * same `user_id` filter as {@link listUserActivity}. Kept as a thin mirror of
 * {@link countActivity} because the system-wide activity count is not
 * user-scoped.
 */
export async function countUserActivity(
  userId: string,
  trx?: Knex.Transaction,
): Promise<number> {
  const [row] = await queryBuilder(trx)(AUTH_EVENTS_TABLE)
    .where({ user_id: userId })
    .count<{ count: string }[]>({ count: '*' });
  return toCount(row?.count);
}

/**
 * Apply the optional event-type and time-range filters shared by
 * {@link listActivity} and {@link countActivity}. The time range is inclusive
 * on both ends (Req 6.3, 6.4).
 */
function applyActivityFilter<TRecord extends {}, TResult>(
  query: Knex.QueryBuilder<TRecord, TResult>,
  f: ActivityFilter,
): Knex.QueryBuilder<TRecord, TResult> {
  if (f.eventType !== undefined) {
    query.where('event_type', f.eventType);
  }
  if (f.start !== undefined) {
    query.where('occurred_at', '>=', f.start);
  }
  if (f.end !== undefined) {
    query.where('occurred_at', '<=', f.end);
  }
  return query;
}

/**
 * List a page of the system-wide activity log, filtered by event type and/or
 * time range (Req 6.3, 6.4) and ordered `occurred_at DESC, id DESC` (Req 6.1).
 */
export async function listActivity(
  f: ActivityFilter & { limit: number; offset: number },
  trx?: Knex.Transaction,
): Promise<ActivityEntry[]> {
  const query = queryBuilder(trx)<ActivityRow>(AUTH_EVENTS_TABLE)
    .select(...ACTIVITY_COLUMNS)
    .orderBy('occurred_at', 'desc')
    .orderBy('id', 'desc')
    .limit(f.limit)
    .offset(f.offset);

  applyActivityFilter(query, f);

  const rows = await query;
  return rows.map(mapActivityEntry);
}

/**
 * Count the activity-log records matching the given filters, used to compute
 * pagination metadata totals (Req 6.5). Applies the same filters as
 * {@link listActivity}.
 */
export async function countActivity(
  f: ActivityFilter,
  trx?: Knex.Transaction,
): Promise<number> {
  const query = queryBuilder(trx)(AUTH_EVENTS_TABLE).count<{ count: string }[]>(
    { count: '*' },
  );

  applyActivityFilter(query, f);

  const [row] = await query;
  return toCount(row?.count);
}

/** Raw shape of the {@link aggregateTotals} conditional-count query. */
interface TotalsRow {
  registration: string | number;
  login_success: string | number;
  login_failure: string | number;
}

/**
 * Aggregate the counts of registration, login-success, and login-failure events
 * within an inclusive time range (Req 7.1). Uses PostgreSQL filtered aggregates
 * so all three counts are computed in a single pass over the range.
 */
export async function aggregateTotals(
  range: TimeRange,
  trx?: Knex.Transaction,
): Promise<{ registration: number; loginSuccess: number; loginFailure: number }> {
  const qb = queryBuilder(trx);
  const row = await qb<ActivityRow>(AUTH_EVENTS_TABLE)
    .where('occurred_at', '>=', range.start)
    .andWhere('occurred_at', '<=', range.end)
    .select(
      qb.raw(
        `count(*) filter (where event_type = 'registration') as registration`,
      ),
      qb.raw(
        `count(*) filter (where event_type = 'login-success') as login_success`,
      ),
      qb.raw(
        `count(*) filter (where event_type = 'login-failure') as login_failure`,
      ),
    )
    .first<TotalsRow | undefined>();

  return {
    registration: toCount(row?.registration),
    loginSuccess: toCount(row?.login_success),
    loginFailure: toCount(row?.login_failure),
  };
}

/**
 * Count the distinct users that appear in login-success events within an
 * inclusive time range — the "active users" metric (Req 7.4).
 */
export async function countActiveUsers(
  range: TimeRange,
  trx?: Knex.Transaction,
): Promise<number> {
  const [row] = await queryBuilder(trx)(AUTH_EVENTS_TABLE)
    .where('event_type', 'login-success')
    .andWhere('occurred_at', '>=', range.start)
    .andWhere('occurred_at', '<=', range.end)
    .countDistinct<{ count: string }[]>({ count: 'user_id' });
  return toCount(row?.count);
}

/** Raw shape of the {@link aggregatePerDay} grouped query. */
interface DailyBucketRow {
  interval_start: Date;
  registration: string | number;
  login_success: string | number;
  login_failure: string | number;
}

/**
 * Aggregate registration / login-success / login-failure counts per UTC day
 * across an inclusive time range (Req 7.5).
 *
 * Grouping uses `date_trunc('day', occurred_at at time zone 'UTC')`, and the
 * truncated day is re-interpreted as a UTC `timestamptz` (`... at time zone
 * 'UTC'`) so the driver yields a `Date` at UTC midnight whose `toISOString()`
 * is the correct interval start. Buckets are returned in ascending day order.
 */
export async function aggregatePerDay(
  range: TimeRange,
  trx?: Knex.Transaction,
): Promise<DailyBucket[]> {
  const qb = queryBuilder(trx);
  const dayExpr = `date_trunc('day', occurred_at at time zone 'UTC')`;

  const rows = await qb<ActivityRow>(AUTH_EVENTS_TABLE)
    .where('occurred_at', '>=', range.start)
    .andWhere('occurred_at', '<=', range.end)
    .select(
      qb.raw(`(${dayExpr} at time zone 'UTC') as interval_start`),
      qb.raw(
        `count(*) filter (where event_type = 'registration') as registration`,
      ),
      qb.raw(
        `count(*) filter (where event_type = 'login-success') as login_success`,
      ),
      qb.raw(
        `count(*) filter (where event_type = 'login-failure') as login_failure`,
      ),
    )
    .groupByRaw(dayExpr)
    .orderByRaw(`${dayExpr} asc`);

  return (rows as unknown as DailyBucketRow[]).map((row) => ({
    intervalStart: row.interval_start.toISOString(),
    registration: toCount(row.registration),
    loginSuccess: toCount(row.login_success),
    loginFailure: toCount(row.login_failure),
  }));
}

/**
 * The admin repository: all read queries backing the admin API's user, activity,
 * and analytics endpoints. Every function is transaction-aware and maps
 * snake_case columns to camelCase DTOs, and none read secret columns (Req 8.1).
 */
export const adminRepository = {
  listUsers,
  countUsers,
  findUserSummaryById,
  listUserActivity,
  countUserActivity,
  listActivity,
  countActivity,
  aggregateTotals,
  countActiveUsers,
  aggregatePerDay,
};
