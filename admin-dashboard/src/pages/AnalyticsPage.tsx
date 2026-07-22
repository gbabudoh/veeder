/**
 * Analytics overview — the default landing page.
 *
 * Renders aggregate authentication metrics and a per-day chart for a selected
 * time range. Data is sourced from {@link useAnalytics}; the range selector
 * lets the operator pick the last 7/30/90 days, defaulting to the last 30 days
 * (the hook computes the default when no range is provided).
 *
 * Loading, error, and empty states are delegated to the shared presentational
 * components so behaviour stays consistent across views.
 *
 * Requirements: 15.1, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9
 */

import { useMemo, useState } from 'react';

import { Chart } from '../components/Chart';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useAnalytics, type AnalyticsRange } from '../hooks/useAnalytics';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Selectable range presets (Req 15.9). 30 is the default. */
const RANGE_PRESETS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
] as const;

type RangeDays = (typeof RANGE_PRESETS)[number]['days'];

const DEFAULT_RANGE_DAYS: RangeDays = 30;

export function AnalyticsPage(): JSX.Element {
  const [rangeDays, setRangeDays] = useState<RangeDays>(DEFAULT_RANGE_DAYS);

  // For the default 30-day preset, pass no range so the hook computes its own
  // stable default. For other presets, compute explicit ISO bounds.
  const range = useMemo<AnalyticsRange | undefined>(() => {
    if (rangeDays === DEFAULT_RANGE_DAYS) {
      return undefined;
    }
    const now = Date.now();
    return {
      start: new Date(now - rangeDays * MS_PER_DAY).toISOString(),
      end: new Date(now).toISOString(),
    };
  }, [rangeDays]);

  const {
    data,
    series,
    successRateDisplay,
    isLoading,
    isError,
    isEmpty,
    refetch,
  } = useAnalytics(range);

  return (
    <section className="analytics-page">
      <div className="analytics-page__header">
        <div>
          <h1>Analytics</h1>
          <p>Authentication metrics over the selected period.</p>
        </div>
        <div
          className="analytics-page__range"
          role="group"
          aria-label="Select time range"
        >
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.days}
              type="button"
              className="analytics-page__range-button"
              aria-pressed={rangeDays === preset.days}
              onClick={() => setRangeDays(preset.days)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Loading analytics…" />
      ) : isError ? (
        <ErrorState message="Failed to load analytics." onRetry={refetch} />
      ) : isEmpty || data === undefined ? (
        <EmptyState message="No analytics data for the selected range." />
      ) : (
        <>
          <dl className="analytics-page__metrics">
            <div className="analytics-page__metric">
              <dt>Total registrations</dt>
              <dd>{data.registration}</dd>
            </div>
            <div className="analytics-page__metric">
              <dt>Login successes</dt>
              <dd>{data.loginSuccess}</dd>
            </div>
            <div className="analytics-page__metric">
              <dt>Login failures</dt>
              <dd>{data.loginFailure}</dd>
            </div>
            <div className="analytics-page__metric">
              <dt>Active users</dt>
              <dd>{data.activeUsers}</dd>
            </div>
            <div className="analytics-page__metric">
              <dt>Login success rate</dt>
              <dd>{successRateDisplay}</dd>
            </div>
          </dl>

          <div className="analytics-page__chart">
            <Chart data={series} />
          </div>
        </>
      )}
    </section>
  );
}

export default AnalyticsPage;
