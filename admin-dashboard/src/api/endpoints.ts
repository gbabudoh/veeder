/**
 * Typed admin API calls.
 *
 * Thin wrappers over the shared axios {@link client} that return already
 * unwrapped, typed response data. Query parameters are always passed via axios'
 * `{ params }` option (never interpolated into the URL string) so values such
 * as search terms and pagination tokens are properly encoded. Auth-related
 * calls hit the top-level `/login`, `/refresh`, `/logout` routes; the rest hit
 * the `/admin/*` routes.
 *
 * Requirements: 10.1, 11.7, 12.1, 13.1, 14.1, 15.1
 */

import client from './client';
import type {
  ActivityLogResponse,
  AnalyticsResponse,
  UserDetailResponse,
  UserListResponse,
} from './types';

/** Access/refresh token pair returned by the auth endpoints. */
interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Authenticate with email + password. Returns a fresh access/refresh token
 * pair. `POST /login` (Req 10.1).
 */
export async function login(
  email: string,
  password: string,
): Promise<TokenPair> {
  const response = await client.post<TokenPair>('/login', { email, password });
  return response.data;
}

/**
 * Exchange a refresh token for a new access/refresh token pair.
 * `POST /refresh` (Req 11.7).
 */
export async function refresh(refreshToken: string): Promise<TokenPair> {
  const response = await client.post<TokenPair>('/refresh', { refreshToken });
  return response.data;
}

/**
 * Invalidate the given refresh token server-side. `POST /logout` (Req 11.7).
 */
export async function logout(refreshToken: string): Promise<void> {
  await client.post<void>('/logout', { refreshToken });
}

/**
 * Fetch a paginated, optionally filtered list of users.
 * `GET /admin/users` (Req 12.1).
 */
export async function users(params: {
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<UserListResponse> {
  const response = await client.get<UserListResponse>('/admin/users', {
    params,
  });
  return response.data;
}

/**
 * Fetch a single user's detail plus a page of their recent activity.
 * `GET /admin/users/:id` (Req 13.1).
 */
export async function userDetail(
  id: string,
  params?: { activityPage?: number; activityPageSize?: number },
): Promise<UserDetailResponse> {
  const response = await client.get<UserDetailResponse>(
    `/admin/users/${encodeURIComponent(id)}`,
    { params },
  );
  return response.data;
}

/**
 * Fetch a paginated, optionally filtered authentication activity log.
 * `GET /admin/activity` (Req 14.1).
 */
export async function activity(params: {
  eventType?: string;
  start?: string;
  end?: string;
  page?: number;
  pageSize?: number;
}): Promise<ActivityLogResponse> {
  const response = await client.get<ActivityLogResponse>('/admin/activity', {
    params,
  });
  return response.data;
}

/**
 * Fetch aggregate analytics over an optional time range.
 * `GET /admin/analytics` (Req 15.1).
 */
export async function analytics(params?: {
  start?: string;
  end?: string;
  interval?: 'day';
}): Promise<AnalyticsResponse> {
  const response = await client.get<AnalyticsResponse>('/admin/analytics', {
    params,
  });
  return response.data;
}
