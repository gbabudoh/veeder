/**
 * Admin analytics service.
 *
 * Design reference: `design.md` → "Admin services — `services/adminAnalyticsService.ts`"
 * and the `AnalyticsResponse` DTO. Requirements 7.1–7.6.
 *
 * Orchestrates the analytics aggregate endpoint: it defaults the time range to
 * the most recent 30 days when unbounded (Req 7.6), re-validates the range
 * defensively (rejecting `start > end`, spans over 366 days, and any grouping
 * interval other than `day` — Req 7.7–7.9, which are also enforced at the parse
 * layer), then delegates the three aggregate queries to the
 * {@link adminRepository} and assembles the {@link AnalyticsResponse}.
 *
 * The login success rate is computed by the pure, testable
 * {@link computeLoginSuccessRate} helper: `loginSuccess / (loginSuccess +
 * loginFailure)`, reported as `0` when the denominator is `0` (Req 7.3),
 * rounded to 4 decimal places and guaranteed to lie within `[0, 1]` (Req 7.2).
 *
 * Dependencies are injectable ({@link AdminAnalyticsServiceDeps}) so the service
 * can be unit-tested with a stub repository and a fixed clock; a default
 * instance bound to the real repository and the system clock is exported as
 * {@link adminAnalyticsService}.
 */

import { ValidationError, FieldError } from '../errors';
import type { AnalyticsQuery } from '../validation/adminQuery';
import { MAX_ANALYTICS_SPAN_DAYS } from '../validation/adminQuery';
import {
  adminRepository,
  type DailyBucket,
  type TimeRange,
} from '../repositories/adminRepository';

/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default look-back window, in days, when the range is unbounded (Req 7.6). */
const DEFAULT_RANGE_DAYS = 30;

/** Number of decimal places the login success rate is rounded to (Req 7.2). */
const SUCCESS_RATE_DECIMALS = 4;

/**
 * The analytics aggregate response returned by `GET /admin/analytics`
 * (design.md → DTOs; Req 7.1–7.5). All timestamps are ISO-8601 UTC strings and
 * every count is a non-negative integer.
 */
export interface AnalyticsResponse {
  /** The effective (possibly defaulted) inclusive UTC range, as ISO strings. */
  range: { start: string; end: string };
  /** Count of registration events in the range (≥ 0, Req 7.1). */
  registration: number;
  /** Count of login-success events in the range (≥ 0, Req 7.1). */
  loginSuccess: number;
  /** Count of login-failure events in the range (≥ 0, Req 7.1). */
  loginFailure: number;
  /** Login success rate in `[0, 1]`, 4 dp; `0` when denominator 0 (Req 7.2, 7.3). */
  loginSuccessRate: number;
  /** Distinct users seen in login-success events (≥ 0, Req 7.4). */
  activeUsers: number;
  /** Per-day buckets over the range (Req 7.5). */
  series: DailyBucket[];
}

/** The subset of {@link adminRepository} this service depends on. */
export interface AnalyticsRepository {
  aggregateTotals: typeof adminRepository.aggregateTotals;
  countActiveUsers: typeof adminRepository.countActiveUsers;
  aggregatePerDay: typeof adminRepository.aggregatePerDay;
}

/** Injectable dependencies for {@link createAdminAnalyticsService}. */
export interface AdminAnalyticsServiceDeps {
  /** Repository providing the aggregate queries; defaults to the real one. */
  repository?: AnalyticsRepository;
  /** Clock used to anchor the default range; defaults to `() => new Date()`. */
  now?: () => Date;
}

/** The analytics service surface (design.md → `AdminAnalyticsService`). */
export interface AdminAnalyticsService {
  getAnalytics(input: AnalyticsQuery): Promise<AnalyticsResponse>;
}

/**
 * Compute the login success rate as `loginSuccess / (loginSuccess +
 * loginFailure)` (Req 7.2). Returns `0` when the denominator is `0` rather than
 * dividing (Req 7.3). The result is rounded to 4 decimal places and clamped to
 * the inclusive range `[0, 1]` so it can never fall outside that interval due
 * to rounding or unexpected inputs (Req 7.2).
 *
 * Pure and side-effect free so it can be exercised directly by property tests.
 */
export function computeLoginSuccessRate(
  loginSuccess: number,
  loginFailure: number,
): number {
  const denominator = loginSuccess + loginFailure;
  if (denominator <= 0) {
    // No login attempts in the range: report 0 without dividing (Req 7.3).
    return 0;
  }
  const raw = loginSuccess / denominator;
  const factor = 10 ** SUCCESS_RATE_DECIMALS;
  const rounded = Math.round(raw * factor) / factor;
  // Clamp defensively so the value is guaranteed within [0, 1] (Req 7.2).
  return Math.min(1, Math.max(0, rounded));
}

/**
 * Resolve the effective inclusive time range from the (optional) query bounds,
 * anchored at `now` (Req 7.6).
 *
 * - Both bounds absent → the most recent 30 days: `end = now`, `start = now −
 *   30 days`.
 * - Only `start` supplied → `end = now` (the range runs up to the current
 *   server time).
 * - Only `end` supplied → `start = end − 30 days` (a trailing 30-day window
 *   ending at the supplied bound).
 * - Both supplied → used as-is (subject to the validation below).
 */
function resolveRange(input: AnalyticsQuery, now: Date): TimeRange {
  const end = input.end ?? now;
  const start = input.start ?? new Date(end.getTime() - DEFAULT_RANGE_DAYS * MS_PER_DAY);
  return { start, end };
}

/**
 * Re-validate the effective range and interval defensively (the parse layer
 * validates these first, Req 7.7–7.9). Throws a {@link ValidationError} whose
 * field errors mirror the parse-layer shape.
 */
function validate(range: TimeRange, interval: AnalyticsQuery['interval']): void {
  const fields: FieldError[] = [];

  const spanMs = range.end.getTime() - range.start.getTime();
  if (spanMs < 0) {
    // start later than end (Req 7.7).
    fields.push({ field: 'range', reason: 'start must be less than or equal to end' });
  } else if (spanMs > MAX_ANALYTICS_SPAN_DAYS * MS_PER_DAY) {
    // span exceeds the maximum allowed (Req 7.8).
    fields.push({
      field: 'range',
      reason: `time range must not exceed ${MAX_ANALYTICS_SPAN_DAYS} days`,
    });
  }

  // Only `day` is supported (Req 7.9). Compared as a string so this stays a
  // real runtime guard even though the type only admits `'day' | undefined`.
  if (interval !== undefined && (interval as string) !== 'day') {
    fields.push({ field: 'interval', reason: "interval must be 'day'" });
  }

  if (fields.length > 0) {
    throw new ValidationError(fields);
  }
}

/**
 * Create an {@link AdminAnalyticsService} with injectable dependencies.
 * Omitting `deps` binds the service to the real {@link adminRepository} and the
 * system clock.
 */
export function createAdminAnalyticsService(
  deps: AdminAnalyticsServiceDeps = {},
): AdminAnalyticsService {
  const repository: AnalyticsRepository = deps.repository ?? adminRepository;
  const now = deps.now ?? (() => new Date());

  return {
    async getAnalytics(input: AnalyticsQuery): Promise<AnalyticsResponse> {
      const range = resolveRange(input, now());
      validate(range, input.interval);

      const [totals, activeUsers, series] = await Promise.all([
        repository.aggregateTotals(range),
        repository.countActiveUsers(range),
        repository.aggregatePerDay(range),
      ]);

      return {
        range: {
          start: range.start.toISOString(),
          end: range.end.toISOString(),
        },
        registration: totals.registration,
        loginSuccess: totals.loginSuccess,
        loginFailure: totals.loginFailure,
        loginSuccessRate: computeLoginSuccessRate(
          totals.loginSuccess,
          totals.loginFailure,
        ),
        activeUsers,
        series,
      };
    },
  };
}

/**
 * Default analytics service bound to the real {@link adminRepository} and the
 * system clock.
 */
export const adminAnalyticsService = createAdminAnalyticsService();
