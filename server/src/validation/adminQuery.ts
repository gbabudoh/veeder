/**
 * Query-parameter validation for the admin API.
 *
 * Design reference: `design.md` -> "Components and Interfaces" ->
 * "validation/adminQuery.ts". Every parser returns the same discriminated
 * {@link ValidationResult}/{@link FieldError} shape used by `validation/index.ts`
 * (Req 8.4): either a normalized value (`ok: true`) or a list of field-level
 * failures (`ok: false`), one entry per field that violated a rule.
 *
 * These parsers are pure: they read the request's query/params, never touch the
 * datastore, and never mutate any input or stored data (Req 4.4, 4.10, 5.5,
 * 6.6, 6.7, 7.7, 7.8, 7.9). Clamping of `pageSize` to `[1,100]` and defaulting
 * of the analytics range are intentionally left to the services; here we only
 * reject values that are structurally invalid.
 */

import { z } from 'zod';
import { FieldError } from '../errors';
import { ValidationResult } from './index';

/** Maximum length of a user-search term, in characters, after trimming (Req 4.2, 4.4). */
export const SEARCH_MAX_LENGTH = 254;

/** Default page number when none is supplied (1-based). */
export const DEFAULT_PAGE = 1;

/** Default page size when none is supplied (services clamp to `[1,100]`). */
export const DEFAULT_PAGE_SIZE = 25;

/** Maximum allowed span of an analytics time range, in days (Req 7.8). */
export const MAX_ANALYTICS_SPAN_DAYS = 366;

/** Milliseconds in one day, used for span computation. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The four defined authentication event types (Req 6.3, 6.6). */
export const ACTIVITY_EVENT_TYPES = [
  'registration',
  'login-success',
  'login-failure',
  'logout',
] as const;

/** One of the four defined authentication event types. */
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

/** The only supported analytics grouping interval (Req 7.9). */
export type AnalyticsInterval = 'day';

/** Normalized, validated `GET /admin/users` query (Req 4). */
export interface UsersQuery {
  /** Trimmed 1..254-char search term, or absent when empty/whitespace (Req 4.2, 4.3). */
  search?: string;
  /** 1-based page number (default 1). */
  page: number;
  /** Requested page size (default 25; the service clamps to `[1,100]`). */
  pageSize: number;
}

/** Normalized, validated `:id` path parameter (Req 5.5). */
export interface UuidParam {
  id: string;
}

/** Normalized, validated `GET /admin/activity` query (Req 6). */
export interface ActivityQuery {
  /** One of the four defined event types, or absent for no filter (Req 6.3, 6.6). */
  eventType?: ActivityEventType;
  /** Inclusive start of the time range (Req 6.4), when supplied. */
  start?: Date;
  /** Inclusive end of the time range (Req 6.4), when supplied. */
  end?: Date;
  /** 1-based page number (default 1). */
  page: number;
  /** Requested page size (default 25; the service clamps to `[1,100]`). */
  pageSize: number;
}

/** Normalized, validated `GET /admin/analytics` query (Req 7). */
export interface AnalyticsQuery {
  /** Inclusive start of the range (Req 7.6 default handled by the service). */
  start?: Date;
  /** Inclusive end of the range (Req 7.6 default handled by the service). */
  end?: Date;
  /** Grouping interval; only `day` is supported (Req 7.9). */
  interval?: AnalyticsInterval;
}

// --- Shared helpers --------------------------------------------------------

/**
 * A single query field's value as Express hands it to us. A repeated parameter
 * (`?page=1&page=2`) arrives as an array and a nested parameter as an object;
 * both are rejected as non-string.
 */
type QueryValue = unknown;

/** Only digits, no sign, no decimal point, no whitespace. */
const INTEGER_PATTERN = /^\d+$/;

/** A `.datetime()` schema that accepts only UTC ISO-8601 timestamps (a `Z` suffix). */
const isoUtcSchema = z.string().datetime({ offset: false });

/** A well-formed UUID (any version). */
const uuidSchema = z.string().uuid();

/**
 * Parse an optional 1-based positive-integer query parameter.
 *
 * Absent -> `defaultValue`. Present but non-string, non-numeric, negative,
 * zero, or non-integer -> a {@link FieldError} is appended and `defaultValue`
 * is returned as a placeholder (the caller treats the presence of any field
 * error as overall failure) (Req 4.10, 6.x).
 */
function parsePositiveIntParam(
  value: QueryValue,
  field: string,
  defaultValue: number,
  fields: FieldError[],
): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'string') {
    fields.push({ field, reason: `${field} must be a positive integer` });
    return defaultValue;
  }
  const trimmed = value.trim();
  if (!INTEGER_PATTERN.test(trimmed)) {
    fields.push({ field, reason: `${field} must be a positive integer` });
    return defaultValue;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    fields.push({ field, reason: `${field} must be a positive integer` });
    return defaultValue;
  }
  return parsed;
}

/**
 * Parse an optional UTC ISO-8601 timestamp query parameter into a {@link Date}.
 *
 * Absent -> `undefined`. Present but non-string or not a valid UTC ISO-8601
 * timestamp -> a {@link FieldError} is appended and `undefined` is returned.
 */
function parseTimestampParam(
  value: QueryValue,
  field: string,
  fields: FieldError[],
): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    fields.push({ field, reason: `${field} must be a UTC ISO-8601 timestamp` });
    return undefined;
  }
  const result = isoUtcSchema.safeParse(value);
  if (!result.success) {
    fields.push({ field, reason: `${field} must be a UTC ISO-8601 timestamp` });
    return undefined;
  }
  return new Date(result.data);
}

/**
 * Parse the optional `search` term.
 *
 * Absent, empty, or whitespace-only after trimming -> treated as no search
 * term (`undefined`, Req 4.3). Present but non-string, or longer than
 * {@link SEARCH_MAX_LENGTH} after trimming -> a {@link FieldError} is appended
 * (Req 4.4).
 */
function parseSearchParam(value: QueryValue, fields: FieldError[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    fields.push({ field: 'search', reason: 'search must be a string' });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    // Empty/whitespace-only is treated as absent (Req 4.3).
    return undefined;
  }
  if (trimmed.length > SEARCH_MAX_LENGTH) {
    fields.push({
      field: 'search',
      reason: `search must be at most ${SEARCH_MAX_LENGTH} characters`,
    });
    return undefined;
  }
  return trimmed;
}

/** Read a single named property from an unknown query/params object. */
function readField(source: unknown, key: string): QueryValue {
  if (typeof source === 'object' && source !== null && !Array.isArray(source)) {
    return (source as Record<string, unknown>)[key];
  }
  return undefined;
}

// --- Users query -----------------------------------------------------------

/**
 * Validate and normalize the `GET /admin/users` query parameters.
 * Reports one {@link FieldError} per invalid parameter and mutates nothing
 * (Req 4.4, 4.10).
 */
export function parseUsersQuery(query: unknown): ValidationResult<UsersQuery> {
  const fields: FieldError[] = [];

  const search = parseSearchParam(readField(query, 'search'), fields);
  const page = parsePositiveIntParam(readField(query, 'page'), 'page', DEFAULT_PAGE, fields);
  const pageSize = parsePositiveIntParam(
    readField(query, 'pageSize'),
    'pageSize',
    DEFAULT_PAGE_SIZE,
    fields,
  );

  if (fields.length > 0) {
    return { ok: false, fields };
  }

  const value: UsersQuery = { page, pageSize };
  if (search !== undefined) {
    value.search = search;
  }
  return { ok: true, value };
}

// --- UUID path parameter ---------------------------------------------------

/**
 * Validate the `:id` path parameter as a well-formed UUID without touching the
 * datastore (Req 5.5). An invalid identifier yields a single `id` field error.
 */
export function parseUuidParam(id: unknown): ValidationResult<UuidParam> {
  const result = uuidSchema.safeParse(id);
  if (!result.success) {
    return {
      ok: false,
      fields: [{ field: 'id', reason: 'id must be a well-formed UUID' }],
    };
  }
  return { ok: true, value: { id: result.data } };
}

// --- Activity query --------------------------------------------------------

/**
 * Validate and normalize the `GET /admin/activity` query parameters.
 *
 * Rejects an out-of-set `eventType` (Req 6.6), malformed timestamps, a range
 * whose start is later than its end (Req 6.7), and invalid pagination. Reports
 * one {@link FieldError} per invalid field and mutates nothing.
 */
export function parseActivityQuery(query: unknown): ValidationResult<ActivityQuery> {
  const fields: FieldError[] = [];

  let eventType: ActivityEventType | undefined;
  const rawEventType = readField(query, 'eventType');
  if (rawEventType !== undefined) {
    const eventTypeResult = z.enum(ACTIVITY_EVENT_TYPES).safeParse(rawEventType);
    if (!eventTypeResult.success) {
      fields.push({
        field: 'eventType',
        reason: `eventType must be one of ${ACTIVITY_EVENT_TYPES.join(', ')}`,
      });
    } else {
      eventType = eventTypeResult.data;
    }
  }

  const start = parseTimestampParam(readField(query, 'start'), 'start', fields);
  const end = parseTimestampParam(readField(query, 'end'), 'end', fields);

  // Cross-field range check only when both bounds parsed successfully (Req 6.7).
  if (start !== undefined && end !== undefined && start.getTime() > end.getTime()) {
    fields.push({
      field: 'range',
      reason: 'start must be less than or equal to end',
    });
  }

  const page = parsePositiveIntParam(readField(query, 'page'), 'page', DEFAULT_PAGE, fields);
  const pageSize = parsePositiveIntParam(
    readField(query, 'pageSize'),
    'pageSize',
    DEFAULT_PAGE_SIZE,
    fields,
  );

  if (fields.length > 0) {
    return { ok: false, fields };
  }

  const value: ActivityQuery = { page, pageSize };
  if (eventType !== undefined) {
    value.eventType = eventType;
  }
  if (start !== undefined) {
    value.start = start;
  }
  if (end !== undefined) {
    value.end = end;
  }
  return { ok: true, value };
}

// --- Analytics query -------------------------------------------------------

/**
 * Validate and normalize the `GET /admin/analytics` query parameters.
 *
 * Rejects malformed timestamps, a range whose start is later than its end
 * (Req 7.7), a span exceeding {@link MAX_ANALYTICS_SPAN_DAYS} days (Req 7.8),
 * and any grouping interval other than `day` (Req 7.9). The default range
 * (last 30 days) is applied by the service, not here (Req 7.6). Mutates
 * nothing.
 */
export function parseAnalyticsQuery(query: unknown): ValidationResult<AnalyticsQuery> {
  const fields: FieldError[] = [];

  const start = parseTimestampParam(readField(query, 'start'), 'start', fields);
  const end = parseTimestampParam(readField(query, 'end'), 'end', fields);

  if (start !== undefined && end !== undefined) {
    const spanMs = end.getTime() - start.getTime();
    if (spanMs < 0) {
      // start later than end (Req 7.7).
      fields.push({
        field: 'range',
        reason: 'start must be less than or equal to end',
      });
    } else if (spanMs > MAX_ANALYTICS_SPAN_DAYS * MS_PER_DAY) {
      // span exceeds the maximum allowed (Req 7.8).
      fields.push({
        field: 'range',
        reason: `time range must not exceed ${MAX_ANALYTICS_SPAN_DAYS} days`,
      });
    }
  }

  let interval: AnalyticsInterval | undefined;
  const rawInterval = readField(query, 'interval');
  if (rawInterval !== undefined) {
    const intervalResult = z.literal('day').safeParse(rawInterval);
    if (!intervalResult.success) {
      fields.push({ field: 'interval', reason: "interval must be 'day'" });
    } else {
      interval = intervalResult.data;
    }
  }

  if (fields.length > 0) {
    return { ok: false, fields };
  }

  const value: AnalyticsQuery = {};
  if (start !== undefined) {
    value.start = start;
  }
  if (end !== undefined) {
    value.end = end;
  }
  if (interval !== undefined) {
    value.interval = interval;
  }
  return { ok: true, value };
}
