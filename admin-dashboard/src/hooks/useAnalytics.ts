/**
 * TanStack React Query hook for the analytics overview view.
 *
 * Fetches aggregate analytics for a selected Time_Range and exposes the pieces
 * the analytics page needs: the raw aggregates, a chart-ready `series`, a
 * pre-formatted login success-rate string, plus loading/error/empty states and
 * a `refetch` for the retry control.
 *
 * When no range is provided the hook defaults to the last 30 days (Req 15.3).
 * The default range is computed once per hook instance via `useMemo` so it does
 * not change on every render; the query key uses the *provided* range values,
 * or a stable `['analytics', 'default']` key when none are provided, avoiding a
 * new cache key (and refetch) on each render.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { analytics as fetchAnalytics } from '../api/endpoints';
import type { AnalyticsResponse, DailyBucket } from '../api/types';

/** Number of days in the default Time_Range (Req 15.3). */
const DEFAULT_RANGE_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Format a login success rate ratio in `[0, 1]` as a percentage string with one
 * decimal place (Req 15.2). Returns `'0.0%'` for a rate of 0 and for degenerate
 * inputs (`NaN`, or a non-finite value produced by a zero-denominator ratio).
 *
 * Pure and side-effect free by design so it can be exercised directly by the
 * analytics property test.
 *
 * @example
 * formatSuccessRatePercent(0.8234); // => '82.3%'
 * formatSuccessRatePercent(0);      // => '0.0%'
 */
export function formatSuccessRatePercent(rate: number): string {
  if (!Number.isFinite(rate) || rate === 0) {
    return '0.0%';
  }
  return `${(rate * 100).toFixed(1)}%`;
}

/** Explicit Time_Range bounds; both ISO-8601 UTC strings when present. */
export interface AnalyticsRange {
  start?: string;
  end?: string;
}

/** Result surface returned by {@link useAnalytics}. */
export interface UseAnalyticsResult {
  data: AnalyticsResponse | undefined;
  series: DailyBucket[];
  successRateDisplay: string;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  refetch: () => void;
}

/**
 * Fetch analytics aggregates for the given Time_Range, defaulting to the last
 * 30 days when no range is provided.
 */
export function useAnalytics(range?: AnalyticsRange): UseAnalyticsResult {
  // Compute a stable default range once per hook instance so it does not shift
  // on every render (Req 15.3).
  const defaultRange = useMemo<Required<AnalyticsRange>>(
    () => ({
      end: new Date().toISOString(),
      start: new Date(Date.now() - DEFAULT_RANGE_DAYS * MS_PER_DAY).toISOString(),
    }),
    [],
  );

  const start = range?.start ?? defaultRange.start;
  const end = range?.end ?? defaultRange.end;

  // Keep the query key stable: use the provided range values when present, or a
  // fixed sentinel when defaulting, so the default range does not churn the key.
  const queryKey = range
    ? (['analytics', range.start, range.end] as const)
    : (['analytics', 'default'] as const);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchAnalytics({ start, end, interval: 'day' }),
  });

  const successRateDisplay = formatSuccessRatePercent(
    query.data?.loginSuccessRate ?? 0,
  );

  const series = query.data?.series ?? [];

  // Empty only after a successful response where every aggregate total is zero
  // (Req 15.7). Active-user count is implied zero when the three event totals
  // are zero, so the totals check is sufficient.
  const isEmpty =
    query.isSuccess &&
    query.data.registration + query.data.loginSuccess + query.data.loginFailure ===
      0;

  return {
    data: query.data,
    series,
    successRateDisplay,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isEmpty,
    refetch: query.refetch,
  };
}
