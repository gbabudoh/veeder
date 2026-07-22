/**
 * User detail view.
 *
 * Reads the `:id` route param, fetches the user's detail and recent activity
 * via {@link useUserDetail}, and renders the summary (email, role, createdAt)
 * plus the returned activity records ordered most-recent-first (Req 13.1).
 *
 * State handling is driven by the hook's flags and `errorKind`:
 * - `isLoading` -> {@link LoadingState} (Req 13.2).
 * - `errorKind === 'not-found'` -> a not-found message, no detail shown (Req 13.4).
 * - `errorKind === 'unauthorized'` -> a not-authorized message, no detail shown (Req 13.6).
 * - `errorKind === 'timeout' | 'other'` -> {@link ErrorState} with retry (Req 13.5, 13.7).
 * - success with zero activity records -> {@link EmptyState} (Req 13.3).
 *
 * A back link returns to the users list at `/users`.
 *
 * Requirements: 13.1, 13.3, 13.4, 13.5, 13.6, 13.7
 */

import { Link, useParams } from 'react-router-dom';

import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingState from '../components/LoadingState';
import { useUserDetail } from '../hooks/useUserDetail';

/** Back navigation control to the users list (Req 13.x navigation). */
function BackToUsersLink(): JSX.Element {
  return (
    <Link to="/users" className="user-detail__back">
      ← Back to users
    </Link>
  );
}

export default function UserDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, errorKind, refetch } = useUserDetail(id ?? '');

  // In-progress request (Req 13.2).
  if (isLoading) {
    return (
      <main className="user-detail">
        <BackToUsersLink />
        <LoadingState label="Loading user…" />
      </main>
    );
  }

  // 404 — account not found; do not render any detail (Req 13.4).
  if (errorKind === 'not-found') {
    return (
      <main className="user-detail">
        <BackToUsersLink />
        <p role="alert" className="user-detail__not-found">
          User not found.
        </p>
      </main>
    );
  }

  // 401/403 — not authorized; do not render any detail (Req 13.6).
  if (errorKind === 'unauthorized') {
    return (
      <main className="user-detail">
        <BackToUsersLink />
        <p role="alert" className="user-detail__unauthorized">
          You are not authorized to view this user.
        </p>
      </main>
    );
  }

  // Timeout or other failure — error with retry (Req 13.5, 13.7).
  if (errorKind === 'timeout' || errorKind === 'other') {
    return (
      <main className="user-detail">
        <BackToUsersLink />
        <ErrorState
          message="Could not load this user. Please try again."
          onRetry={refetch}
        />
      </main>
    );
  }

  // No data available yet (query disabled / not settled). Guard for types.
  if (data === undefined) {
    return (
      <main className="user-detail">
        <BackToUsersLink />
        <LoadingState label="Loading user…" />
      </main>
    );
  }

  // Success — render the user summary and their activity (Req 13.1, 13.3).
  return (
    <main className="user-detail">
      <BackToUsersLink />

      <section className="user-detail__summary" aria-label="User details">
        <h1 className="user-detail__email">{data.email}</h1>
        <dl className="user-detail__fields">
          <div className="user-detail__field">
            <dt>Role</dt>
            <dd>{data.role}</dd>
          </div>
          <div className="user-detail__field">
            <dt>Created</dt>
            <dd>
              <time dateTime={data.createdAt}>{data.createdAt}</time>
            </dd>
          </div>
        </dl>
      </section>

      <section className="user-detail__activity" aria-label="Recent activity">
        <h2>Recent activity</h2>
        {data.activity.length === 0 ? (
          <EmptyState message="No activity is recorded for this user." />
        ) : (
          <ul className="user-detail__activity-list">
            {data.activity.map((entry) => (
              <li key={entry.id} className="user-detail__activity-item">
                <span className="user-detail__event-type">{entry.eventType}</span>
                <time dateTime={entry.occurredAt}>{entry.occurredAt}</time>
                <span className="user-detail__source-ip">
                  {entry.sourceIp ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
