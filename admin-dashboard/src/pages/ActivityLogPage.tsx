/**
 * Activity log page.
 *
 * Owns the event-type and time-range filter UI state and drives the
 * `useActivity` infinite query with them (Req 14.1, 14.2). The event-type
 * selector offers `all` plus the four defined event types; selecting `all`
 * omits the `eventType` filter entirely. The start/end inputs are
 * `datetime-local` controls whose values are converted to ISO-8601 UTC strings
 * before being handed to the hook; empty inputs omit that bound (Req 14.2).
 *
 * Activity entries are rendered from `events` in the descending order the hook
 * provides (Req 14.1, 14.3). A "Load more" control is wired to `loadMore()` and
 * is hidden when no further pages remain, showing a loading indicator while the
 * next page is in flight (Req 14.3, 14.4).
 *
 * Loading, error, and empty states are delegated to the shared state components
 * (Req 14.5, 14.7). When the API rejects the requested range with a `400`, the
 * `rangeError` message is displayed prominently (Req 14.6, 14.8).
 *
 * Requirements: 14.1, 14.2, 14.3, 14.5, 14.6, 14.7, 14.8
 */

import { useState } from 'react';

import { useActivity } from '../hooks/useActivity';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';

/** Event-type selector options; `all` maps to "no event-type filter". */
const EVENT_TYPE_OPTIONS = [
  { value: 'all', label: 'All events' },
  { value: 'registration', label: 'Registration' },
  { value: 'login-success', label: 'Login success' },
  { value: 'login-failure', label: 'Login failure' },
  { value: 'logout', label: 'Logout' },
] as const;

/** Best-effort extraction of a human-readable message from an unknown error. */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Failed to load the activity log. Please try again.';
}

/**
 * Convert a `datetime-local` input value to an ISO-8601 UTC string, or
 * `undefined` when the input is empty or unparseable (so the bound is omitted).
 */
function toIsoUtc(value: string): string | undefined {
  if (value.trim() === '') {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

export default function ActivityLogPage(): JSX.Element {
  // Raw UI state: the selector value and the datetime-local input strings.
  const [eventType, setEventType] = useState<string>('all');
  const [startInput, setStartInput] = useState<string>('');
  const [endInput, setEndInput] = useState<string>('');

  // Derive the filter object passed to the hook, omitting empty bounds and the
  // "all" event-type sentinel (Req 14.2).
  const filters = {
    eventType: eventType === 'all' ? undefined : eventType,
    start: toIsoUtc(startInput),
    end: toIsoUtc(endInput),
  };

  const {
    events,
    isLoading,
    isError,
    error,
    rangeError,
    isEmpty,
    hasNextPage,
    isFetchingNextPage,
    loadMore,
    refetch,
  } = useActivity(filters);

  return (
    <section className="activity-log-page">
      <div className="page-header">
        <h1>Activity Log</h1>
        <p>Authentication events ordered most-recent first.</p>
      </div>

      <div className="activity-log-page__filters">
        <label className="activity-log-page__filter">
          <span>Event type</span>
          <select aria-label="Filter by event type" value={eventType} onChange={(e) => setEventType(e.target.value)}>
            {EVENT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="activity-log-page__filter">
          <span>From</span>
          <input type="datetime-local" aria-label="Range start" value={startInput} onChange={(e) => setStartInput(e.target.value)} />
        </label>
        <label className="activity-log-page__filter">
          <span>To</span>
          <input type="datetime-local" aria-label="Range end" value={endInput} onChange={(e) => setEndInput(e.target.value)} />
        </label>
      </div>

      {rangeError !== null && (
        <div role="alert" className="activity-log-page__range-error">{rangeError}</div>
      )}

      {isLoading ? (
        <LoadingState label="Loading activity…" />
      ) : isError ? (
        <ErrorState message={toErrorMessage(error)} onRetry={refetch} />
      ) : isEmpty ? (
        <EmptyState message="No activity matches the current filters." />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Occurred</th>
                  <th scope="col">Email</th>
                  <th scope="col">Source IP</th>
                </tr>
              </thead>
              <tbody>
                {events.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <span className={`badge badge--${
                        entry.eventType === 'login-success' ? 'success' :
                        entry.eventType === 'login-failure' ? 'danger' :
                        entry.eventType === 'registration' ? 'info' : 'warn'
                      }`}>{entry.eventType}</span>
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{new Date(entry.occurredAt).toLocaleString()}</td>
                    <td>{entry.email ?? '—'}</td>
                    <td style={{ color: 'var(--text-3)', fontFamily: 'monospace' }}>{entry.sourceIp ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasNextPage && (
            <button type="button" className="activity-log-page__load-more" onClick={loadMore} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
