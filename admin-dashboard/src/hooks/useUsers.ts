/**
 * TanStack React Query hook for the paginated users list.
 *
 * Debounces the free-text `search` input by 400ms before it participates in the
 * query key / request so rapid typing does not fire a request per keystroke
 * (Req 12.3). Because each distinct (debouncedSearch, page) pair produces a
 * distinct query key, React Query's built-in request cancellation and cache
 * keying discard stale responses when inputs change (Req 12.4).
 *
 * The returned surface is tailored to what the users page needs: loading,
 * error, and empty states plus `refetch` (Req 12.5–12.9). `isEmpty` is only
 * true once a request has succeeded and yielded zero users.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { users as fetchUsers } from '../api/endpoints';
import type { UserListResponse } from '../api/types';

/** Fixed page size for the users list (Req 12.2). */
const PAGE_SIZE = 25;

/** Debounce interval (ms) applied to the search input (Req 12.3). */
const SEARCH_DEBOUNCE_MS = 400;

/**
 * Returns `value` delayed by `delayMs`. The debounced value only updates once
 * the input has been stable for the full delay; pending timers are cleared on
 * each change so intermediate values never propagate.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/** Arguments accepted by {@link useUsers}. */
export interface UseUsersArgs {
  search: string;
  page: number;
}

/** Result surface returned by {@link useUsers}. */
export interface UseUsersResult {
  data: UserListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  refetch: () => void;
}

/**
 * Fetch a page of users filtered by a debounced search term.
 */
export function useUsers({ search, page }: UseUsersArgs): UseUsersResult {
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const query = useQuery({
    queryKey: ['users', debouncedSearch, page],
    queryFn: () =>
      fetchUsers({
        search: debouncedSearch || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const isEmpty = query.isSuccess && query.data.users.length === 0;

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isEmpty,
    refetch: query.refetch,
  };
}
