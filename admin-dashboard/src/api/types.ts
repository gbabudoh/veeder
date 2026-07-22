/**
 * Shared DTO types for the admin dashboard.
 *
 * These types mirror the backend admin API response contracts exactly (see the
 * design's "Response DTOs" section and `server/` admin controllers). All
 * timestamps are ISO-8601 UTC strings, and no secret values (password hashes,
 * access/refresh tokens) ever appear in these shapes.
 *
 * Requirements: 11.1
 */

/** Account role. Mirrors the backend `role` column / `Role` type. */
export type Role = 'user' | 'admin';

/**
 * Pagination metadata attached to list responses.
 * `page` is a 1-based indicator echoed back; `pageSize` is the effective size
 * after clamping; `total` is the total count of records matching the request.
 * Mirrors backend `PaginationMeta` (Req 4.6, 6.5).
 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
}

/**
 * A single user summary record. Excludes the hashed password and all tokens.
 * Mirrors backend `UserSummary` (Req 4.5, 8.1).
 */
export interface UserSummary {
  id: string;
  email: string;
  role: Role;
  /** ISO-8601 UTC */
  createdAt: string;
}

/** Paginated users list response. Mirrors backend `UserListResponse`. */
export interface UserListResponse {
  users: UserSummary[];
  pagination: PaginationMeta;
}

/**
 * One authentication event record. Mirrors backend `ActivityEntry` (Req 6.2).
 */
export interface ActivityEntry {
  id: string;
  eventType: 'registration' | 'login-success' | 'login-failure' | 'logout';
  userId: string | null;
  email: string | null;
  sourceIp: string | null;
  /** ISO-8601 UTC */
  occurredAt: string;
}

/**
 * User detail plus a page of that user's recent activity. Excludes the hashed
 * password and all refresh tokens. Mirrors backend `UserDetailResponse`
 * (Req 5.1–5.4).
 */
export interface UserDetailResponse {
  id: string;
  email: string;
  role: Role;
  /** ISO-8601 UTC */
  createdAt: string;
  /** Most-recent-first; default 20 / max 100. */
  activity: ActivityEntry[];
  activityPagination: PaginationMeta;
}

/** Paginated activity-log response. Mirrors backend `ActivityLogResponse`. */
export interface ActivityLogResponse {
  events: ActivityEntry[];
  pagination: PaginationMeta;
}

/**
 * Per-day analytics bucket for a single 24-hour interval.
 * Mirrors backend `DailyBucket` (Req 7.5).
 */
export interface DailyBucket {
  /** ISO-8601 UTC start of the 24h interval. */
  intervalStart: string;
  registration: number;
  loginSuccess: number;
  loginFailure: number;
}

/**
 * Analytics aggregates over a requested time range. Mirrors backend
 * `AnalyticsResponse` (Req 7).
 */
export interface AnalyticsResponse {
  /** ISO-8601 UTC bounds of the aggregated range. */
  range: { start: string; end: string };
  /** >= 0 */
  registration: number;
  /** >= 0 */
  loginSuccess: number;
  /** >= 0 */
  loginFailure: number;
  /** In [0,1], 4 dp; 0 when denominator is 0 (Req 7.2, 7.3). */
  loginSuccessRate: number;
  /** Distinct login-success user ids; >= 0 (Req 7.4). */
  activeUsers: number;
  /** Per-day series (Req 7.5). */
  series: DailyBucket[];
}

/**
 * Structured error response shape reused from the backend service.
 * Mirrors backend `ErrorBody` (Req 8.4).
 */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Array<{ field: string; message: string }>;
  };
}
