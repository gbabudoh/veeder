/**
 * Users list page.
 *
 * Owns the `search` and `page` UI state and drives the `useUsers` query with
 * them (Req 12.1, 12.2). Search input changes reset the page back to 1 so the
 * user always sees the first page of the new result set; debouncing of the
 * search term is handled inside `useUsers` (Req 12.3). Rows are selectable and
 * navigate to the user detail route (Req 12.10). Loading, error, and empty
 * states are delegated to the shared state components (Req 12.6–12.9), and
 * pagination is delegated to the shared `Pagination` control (Req 12.5).
 *
 * Requirements: 12.1, 12.2, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useUsers } from '../hooks/useUsers';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { Pagination } from '../components/Pagination';
import type { UserSummary } from '../api/types';

/** Best-effort extraction of a human-readable message from an unknown error. */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Failed to load users. Please try again.';
}

export default function UsersListPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const navigate = useNavigate();

  const { data, isLoading, isError, error, isEmpty, refetch } = useUsers({
    search,
    page,
  });

  /** Update the search term and reset to the first page (Req 12.2). */
  function handleSearchChange(value: string): void {
    setSearch(value);
    setPage(1);
  }

  /** Navigate to the detail route for the selected user (Req 12.10). */
  function handleSelectUser(user: UserSummary): void {
    navigate(`/users/${user.id}`);
  }

  return (
    <section className="users-list-page">
      <div className="page-header">
        <h1>Users</h1>
        <p>Browse and manage all registered accounts.</p>
      </div>

      <div className="users-list-page__toolbar">
        <input
          type="search"
          className="users-list-page__search"
          placeholder="Search by email…"
          aria-label="Search users"
          value={search}
          onChange={(event) => handleSearchChange(event.target.value)}
        />
        {data && (
          <span style={{ fontSize: '.82rem', color: 'var(--text-3)', marginLeft: 'auto' }}>
            {data.pagination.total} user{data.pagination.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {isLoading ? (
        <LoadingState label="Loading users…" />
      ) : isError ? (
        <ErrorState message={toErrorMessage(error)} onRetry={refetch} />
      ) : isEmpty ? (
        <EmptyState message="No users found." />
      ) : data !== undefined ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Registered</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((user) => (
                  <tr
                    key={user.id}
                    className="clickable-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectUser(user)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleSelectUser(user);
                      }
                    }}
                  >
                    <td>{user.email}</td>
                    <td>
                      <span className={`badge badge--${user.role}`}>{user.role}</span>
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data.pagination.page}
            pageSize={data.pagination.pageSize}
            total={data.pagination.total}
            onPageChange={setPage}
          />
        </>
      ) : null}
    </section>
  );
}
