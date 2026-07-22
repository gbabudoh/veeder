/**
 * TanStack React Query hook for a single user's detail plus recent activity.
 *
 * Wraps `GET /admin/users/:id` (via {@link fetchUserDetail}) with a 30-second
 * request timeout (Req 13.1, 13.7). Because `endpoints.userDetail` does not
 * currently accept an `AbortSignal`, the timeout is implemented in the queryFn
 * by racing the request against a timer that rejects with a distinguishable
 * {@link UserDetailTimeoutError}. When the timer wins, the query settles as an
 * error whose `errorKind` is `'timeout'`.
 *
 * The hook classifies the failure for the view via `errorKind` so the page can
 * distinguish not-found (404), unauthorized (401/403), timeout, and other
 * failures without re-inspecting the raw error (Req 13.4, 13.5, 13.6, 13.7).
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7
 */

import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

import { userDetail as fetchUserDetail } from '../api/endpoints';
import type { UserDetailResponse } from '../api/types';

/** Request timeout applied to the user-detail query (Req 13.1, 13.7). */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Error thrown when the user-detail request exceeds {@link REQUEST_TIMEOUT_MS}.
 * A distinct class lets {@link classifyError} map the timeout to `'timeout'`
 * regardless of the underlying axios/network state.
 */
export class UserDetailTimeoutError extends Error {
  constructor(message = 'User detail request timed out') {
    super(message);
    this.name = 'UserDetailTimeoutError';
  }
}

/** Options accepted by {@link useUserDetail}. */
export interface UseUserDetailOpts {
  activityPage?: number;
  activityPageSize?: number;
}

/** Discriminated classification of a user-detail failure for the view. */
export type UserDetailErrorKind =
  | 'not-found'
  | 'unauthorized'
  | 'timeout'
  | 'other'
  | null;

/** Result surface returned by {@link useUserDetail}. */
export interface UseUserDetailResult {
  data: UserDetailResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  errorKind: UserDetailErrorKind;
  refetch: () => void;
}

/**
 * Classify a query error into a view-facing {@link UserDetailErrorKind}.
 *
 * - The timeout rejection -> `'timeout'` (Req 13.7).
 * - Axios 404 -> `'not-found'` (Req 13.4).
 * - Axios 401 or 403 -> `'unauthorized'` (Req 13.6).
 * - Anything else (including non-axios errors) -> `'other'` (Req 13.5).
 * - No error -> `null`.
 */
function classifyError(error: unknown): UserDetailErrorKind {
  if (error === null || error === undefined) {
    return null;
  }
  if (error instanceof UserDetailTimeoutError) {
    return 'timeout';
  }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 404) {
      return 'not-found';
    }
    if (status === 401 || status === 403) {
      return 'unauthorized';
    }
  }
  return 'other';
}

/**
 * Fetch `endpoints.userDetail(id, opts)`, rejecting with
 * {@link UserDetailTimeoutError} if it does not settle within
 * {@link REQUEST_TIMEOUT_MS}.
 */
function fetchWithTimeout(
  id: string,
  opts?: UseUserDetailOpts,
): Promise<UserDetailResponse> {
  return new Promise<UserDetailResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new UserDetailTimeoutError());
    }, REQUEST_TIMEOUT_MS);

    fetchUserDetail(id, opts)
      .then((data) => {
        clearTimeout(timer);
        resolve(data);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        reject(err as Error);
      });
  });
}

/**
 * Fetch a single user's detail and a page of their recent activity.
 *
 * The query is disabled until a non-empty `id` is supplied.
 */
export function useUserDetail(
  id: string,
  opts?: UseUserDetailOpts,
): UseUserDetailResult {
  const query = useQuery({
    queryKey: ['userDetail', id, opts?.activityPage, opts?.activityPageSize],
    queryFn: () => fetchWithTimeout(id, opts),
    enabled: Boolean(id),
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    errorKind: classifyError(query.error),
    refetch: query.refetch,
  };
}
