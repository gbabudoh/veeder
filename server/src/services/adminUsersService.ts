import { adminRepository } from '../repositories/adminRepository';
import type {
  ActivityEntry,
  UserSummary,
} from '../repositories/adminRepository';

/**
 * Admin users service.
 *
 * Orchestrates the user list/search and user-detail read flows for the admin
 * API, sitting between the thin controllers and {@link adminRepository}. Its
 * responsibilities are pagination policy (clamping/defaulting `pageSize`,
 * computing the offset from a 1-based page) and shaping the repository rows
 * into the response DTOs; it performs no query building or column mapping of
 * its own.
 *
 * Design reference: `design.md` → "Admin services" → `adminUsersService`.
 * Requirements 4.6, 4.7, 4.8, 4.9, 5.1, 5.2, 5.3, 5.6.
 *
 * Dependencies are injected via {@link createAdminUsersService} so the service
 * can be unit-tested against a stub repository without a database. A default
 * {@link adminUsersService} bound to the real {@link adminRepository} is
 * exported for production wiring.
 */

/**
 * Pagination metadata echoed on every paginated admin response (Req 4.6, 5.2).
 * Mirrors the `PaginationMeta` shape in `design.md` → "Response DTOs".
 */
export interface PaginationMeta {
  /** 1-based page indicator echoed back to the caller. */
  page: number;
  /** Effective page size after clamping. */
  pageSize: number;
  /** Total count of records matching the request. */
  total: number;
}

/** A page of user summaries plus its pagination metadata (Req 4.6). */
export interface UserListResponse {
  users: UserSummary[];
  pagination: PaginationMeta;
}

/**
 * A single user's detail plus a page of that user's authentication activity
 * (Req 5.1–5.3). Excludes the hashed password and every token value — the
 * repository never reads those columns (Req 5.4, 8.1).
 */
export interface UserDetailResponse {
  id: string;
  email: string;
  role: UserSummary['role'];
  /** ISO-8601 UTC timestamp. */
  createdAt: string;
  /** Most-recent-first page of the user's events (default 20, max 100). */
  activity: ActivityEntry[];
  activityPagination: PaginationMeta;
}

/** Input for {@link AdminUsersService.listUsers}. */
export interface ListUsersInput {
  /** Trimmed, non-empty search term, or absent for no filter (Req 4.2, 4.3). */
  search?: string;
  /** 1-based page number (Req 4.6). */
  page: number;
  /** Requested page size; clamped to `[1,100]` (Req 4.8, 4.9). */
  pageSize: number;
}

/** Input for {@link AdminUsersService.getUserDetail}. */
export interface GetUserDetailInput {
  /** The user's identifier (already validated as well-formed by the controller). */
  id: string;
  /** 1-based activity page number (default 1). */
  activityPage?: number;
  /** Requested activity page size; clamped to `[1,100]`, default 20 (Req 5.2). */
  activityPageSize?: number;
}

/** The admin users service surface consumed by the user-facing controllers. */
export interface AdminUsersService {
  listUsers(input: ListUsersInput): Promise<UserListResponse>;
  getUserDetail(input: GetUserDetailInput): Promise<UserDetailResponse | null>;
}

/** The subset of {@link adminRepository} this service depends on. */
export interface AdminUsersServiceDeps {
  adminRepository: Pick<
    typeof adminRepository,
    'listUsers' | 'countUsers' | 'findUserSummaryById' | 'listUserActivity' | 'countUserActivity'
  >;
}

/** Minimum allowed page size after clamping (Req 4.8, 4.9). */
export const MIN_PAGE_SIZE = 1;

/** Maximum allowed page size after clamping (Req 4.8). */
export const MAX_PAGE_SIZE = 100;

/** Default page size for the user list when the clamp input is the default (Req 4.9). */
export const DEFAULT_USERS_PAGE_SIZE = 25;

/** Default page size for a user's activity page (Req 5.2). */
export const DEFAULT_ACTIVITY_PAGE_SIZE = 20;

/**
 * Clamp a requested page size into the inclusive `[MIN_PAGE_SIZE, MAX_PAGE_SIZE]`
 * range, substituting `fallback` when the request is `undefined` (Req 4.8, 4.9,
 * 5.2). Pure and side-effect free so it is directly unit-testable. Non-integer
 * inputs are floored toward the nearest valid size within the range.
 */
export function clampPageSize(
  requested: number | undefined,
  fallback: number,
): number {
  if (requested === undefined || Number.isNaN(requested)) {
    return fallback;
  }
  const floored = Math.floor(requested);
  if (floored < MIN_PAGE_SIZE) {
    return MIN_PAGE_SIZE;
  }
  if (floored > MAX_PAGE_SIZE) {
    return MAX_PAGE_SIZE;
  }
  return floored;
}

/**
 * Clamp a 1-based page number to a minimum of 1 (Req 4.6). Pure helper; the
 * validation layer already rejects non-numeric/zero/negative pages, but the
 * clamp keeps offset computation safe for any caller.
 */
export function clampPage(page: number | undefined): number {
  if (page === undefined || Number.isNaN(page)) {
    return 1;
  }
  const floored = Math.floor(page);
  return floored < 1 ? 1 : floored;
}

/**
 * Compute the zero-based row offset for a 1-based page and effective page size
 * (Req 4.6, 4.7). Pure helper.
 */
export function computeOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/**
 * Build the admin users service from its dependencies (Req 4, 5). Injecting the
 * repository keeps the service unit-testable without a database.
 */
export function createAdminUsersService(
  deps: AdminUsersServiceDeps = { adminRepository },
): AdminUsersService {
  const repo = deps.adminRepository;

  return {
    /**
     * List a page of users, optionally filtered by an email search term. The
     * requested `pageSize` is clamped to `[1,100]` (default 25), the 1-based
     * `page` yields the row offset, and the total count powers the pagination
     * metadata — so an over-range page returns zero rows with an accurate total
     * (Req 4.6, 4.7, 4.8, 4.9).
     */
    async listUsers(input: ListUsersInput): Promise<UserListResponse> {
      const page = clampPage(input.page);
      const pageSize = clampPageSize(input.pageSize, DEFAULT_USERS_PAGE_SIZE);
      const offset = computeOffset(page, pageSize);

      const [users, total] = await Promise.all([
        repo.listUsers({ search: input.search, limit: pageSize, offset }),
        repo.countUsers({ search: input.search }),
      ]);

      return { users, pagination: { page, pageSize, total } };
    },

    /**
     * Return a single user's summary plus a page of that user's authentication
     * activity, or `null` when no user has the given id (the controller maps
     * `null` to a `404`, Req 5.6). The activity page size defaults to 20 and is
     * clamped to `[1,100]` (Req 5.2); the total is a user-scoped count so an
     * over-range activity page returns an empty collection with an accurate
     * total (Req 5.3).
     */
    async getUserDetail(
      input: GetUserDetailInput,
    ): Promise<UserDetailResponse | null> {
      const summary = await repo.findUserSummaryById(input.id);
      if (summary === null) {
        return null;
      }

      const page = clampPage(input.activityPage);
      const pageSize = clampPageSize(
        input.activityPageSize,
        DEFAULT_ACTIVITY_PAGE_SIZE,
      );
      const offset = computeOffset(page, pageSize);

      const [activity, total] = await Promise.all([
        repo.listUserActivity({ userId: input.id, limit: pageSize, offset }),
        repo.countUserActivity(input.id),
      ]);

      return {
        id: summary.id,
        email: summary.email,
        role: summary.role,
        createdAt: summary.createdAt,
        activity,
        activityPagination: { page, pageSize, total },
      };
    },
  };
}

/** Default admin users service bound to the real {@link adminRepository}. */
export const adminUsersService = createAdminUsersService();
