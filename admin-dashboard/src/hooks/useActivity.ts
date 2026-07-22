/**
 * TanStack React Query infinite-scroll hook for the authentication activity log.
 *
 * Uses `useInfiniteQuery` to page through `/admin/activity` 50 records at a time
 * (Req 14.1). Each page is fetched most-recent-first by the backend, and pages
 * are fetched in ascending page order, so concatenating pages in order yields a
 * single `events` array that is globally descending by `occurredAt`
 * (Req 14.1, 14.8).
 *
 * `getNextPageParam` advances to the next page number only while more records
 * remain (`page * pageSize < total`); otherwise it returns `undefined` to stop
 * paging (Req 14.8). `loadMore()` guards against concurrent fetches by only
 * triggering `fetchNextPage()` when a fetch is not already in flight and a next
 * page exists (Req 14.4).
 *
 * When the backend rejects the requested range with a `400`, its structured
 * `ErrorBody` message is surfaced as `rangeError` so the page can show the
 * validation reason (Req 14.6). Loading, error, and empty states are exposed for
 * the activity page (Req 14.2, 14.3, 14.5, 14.7).
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8
 */

import axios from 'axios';
import { useInfiniteQuery } from '@tanstack/react-query';

import { activity as fetchActivity } from '../api/endpoints';
import type { ActivityEntry, ActivityLogResponse, ErrorBody } from '../api/types';

/** Fixed page size for each activity log request (Req 14.1). */
const PAGE_SIZE = 50;

/** Filters accepted by {@link useActivity}. */
export interface UseActivityFilters {
  eventType?: string;
  start?: string;
  end?: string;
}

/** Result surface returned by {@link useActivity}. */
export interface UseActivityResult {
  events: ActivityEntry[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  /** 400 range-validation message from the API, when present (Req 14.6). */
  rangeError: string | null;
  /** True once a request succeeds and yields zero events (Req 14.5). */
  isEmpty: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** Fetch the next page, unless one is already in flight (Req 14.4). */
  loadMore: () => void;
  refetch: () => void;
}

/**
 * Extract the structured `ErrorBody` message from a `400` API error, if any.
 * Returns `null` for non-axios errors, non-`400` statuses, or missing bodies.
 */
function extractRangeError(error: unknown): string | null {
  if (!axios.isAxiosError(error)) {
    return null;
  }
  if (error.response?.status !== 400) {
    return null;
  }
  const body = error.response.data as ErrorBody | undefined;
  return body?.error?.message ?? null;
}

/**
 * Fetch the activity log as an infinite, filterable, descending-ordered stream.
 */
export function useActivity(filters: UseActivityFilters): UseActivityResult {
  const query = useInfiniteQuery<ActivityLogResponse>({
    queryKey: ['activity', filters.eventType, filters.start, filters.end],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      fetchActivity({
        ...filters,
        page: pageParam as number,
        pageSize: PAGE_SIZE,
      }),
    getNextPageParam: (lastPage) => {
      const { page, pageSize, total } = lastPage.pagination;
      return page * pageSize < total ? page + 1 : undefined;
    },
  });

  const events: ActivityEntry[] =
    query.data?.pages.flatMap((page) => page.events) ?? [];

  const isEmpty = query.isSuccess && events.length === 0;

  const loadMore = () => {
    if (!query.isFetchingNextPage && query.hasNextPage) {
      void query.fetchNextPage();
    }
  };

  return {
    events,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    rangeError: extractRangeError(query.error),
    isEmpty,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    loadMore,
    refetch: query.refetch,
  };
}
