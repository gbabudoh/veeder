import {
  adminRepository,
  type ActivityEntry,
  type ActivityFilter,
} from '../repositories/adminRepository';
import { ValidationError, type FieldError } from '../errors';

/**
 * Admin_Activity_Service.
 *
 * Design reference: `design.md` → "Admin services" (`adminActivityService`) and
 * "DTOs / API Contracts" (`ActivityLogResponse`, `PaginationMeta`).
 * Requirements 6.5, 6.8, 6.9, 6.10.
 *
 * Orchestrates the system-wide activity-log endpoint:
 *
 * 1. Defensively re-validate the time range: when both `start` and `end` are
 *    supplied, require `start <= end`; otherwise throw a {@link ValidationError}
 *    carrying a single `range` field error (Req 6.10 — the parse layer already
 *    enforces this, but the service must not trust its caller).
 * 2. Clamp the requested `pageSize` into `[1, 100]`, defaulting to 25 when
 *    omitted, so an oversized page never returns more than 100 records
 *    (Req 6.8, 6.9).
 * 3. Compute the datastore `offset` from the 1-based `page`.
 * 4. Delegate the filtered/paged read and the matching total-count to
 *    {@link adminRepository}, then assemble `{ events, pagination }` where the
 *    pagination metadata echoes the requested page, the effective (clamped)
 *    page size, and the true total of matching records (Req 6.5).
 *
 * Event ordering (`occurred_at DESC, id DESC`) is guaranteed by the repository,
 * so this service performs no reordering.
 */

/** Minimum effective page size after clamping. */
export const MIN_PAGE_SIZE = 1;

/** Maximum effective page size after clamping (Req 6.8). */
export const MAX_PAGE_SIZE = 100;

/** Default page size applied when the request omits it (Req 6.9). */
export const DEFAULT_PAGE_SIZE = 25;

/** A single 1-based page's metadata (Req 6.5). */
export interface PaginationMeta {
  /** 1-based page indicator echoed back to the caller. */
  page: number;
  /** Effective page size after clamping to `[1, 100]`. */
  pageSize: number;
  /** Total count of records matching the request (ignoring pagination). */
  total: number;
}

/** The system-wide activity-log response (Req 6.5). */
export interface ActivityLogResponse {
  events: ActivityEntry[];
  pagination: PaginationMeta;
}

/** Normalized input to {@link AdminActivityService.listActivity}. */
export interface ListActivityInput {
  /** One of the four defined event types, or absent for no filter (Req 6.3). */
  eventType?: ActivityFilter['eventType'];
  /** Inclusive start of the time range (Req 6.4), when supplied. */
  start?: Date;
  /** Inclusive end of the time range (Req 6.4), when supplied. */
  end?: Date;
  /** 1-based page number. */
  page: number;
  /** Requested page size (clamped to `[1, 100]`, default 25). */
  pageSize: number;
}

/** Minimal shape of the admin repository this service depends on. */
export interface AdminActivityRepo {
  listActivity(
    f: ActivityFilter & { limit: number; offset: number },
  ): Promise<ActivityEntry[]>;
  countActivity(f: ActivityFilter): Promise<number>;
}

/** Dependencies for {@link createAdminActivityService}. All optional/defaulted. */
export interface AdminActivityServiceDeps {
  adminRepo?: AdminActivityRepo;
}

/** The Admin_Activity_Service surface. */
export interface AdminActivityService {
  /**
   * List a filtered, paged page of the system-wide activity log with pagination
   * metadata (Req 6.5, 6.8, 6.9, 6.10).
   *
   * @throws {ValidationError} when both range bounds are present and
   * `start > end` (a single `range` field error, → 400).
   */
  listActivity(input: ListActivityInput): Promise<ActivityLogResponse>;
}

/**
 * Clamp a requested page size into the inclusive `[MIN_PAGE_SIZE, MAX_PAGE_SIZE]`
 * range (Req 6.8). Non-finite or non-integer inputs fall back to the default so
 * the effective size is always a valid positive integer.
 */
function clampPageSize(requested: number): number {
  if (!Number.isFinite(requested)) {
    return DEFAULT_PAGE_SIZE;
  }
  const truncated = Math.trunc(requested);
  if (truncated < MIN_PAGE_SIZE) {
    return MIN_PAGE_SIZE;
  }
  if (truncated > MAX_PAGE_SIZE) {
    return MAX_PAGE_SIZE;
  }
  return truncated;
}

/**
 * Create an Admin_Activity_Service bound to the given (optional) dependencies.
 *
 * With no arguments it wires the real {@link adminRepository}. Injecting a fake
 * repository makes the service fully unit-testable without a datastore.
 */
export function createAdminActivityService(
  deps: AdminActivityServiceDeps = {},
): AdminActivityService {
  const adminRepo = deps.adminRepo ?? adminRepository;

  async function listActivity(
    input: ListActivityInput,
  ): Promise<ActivityLogResponse> {
    const { eventType, start, end, page } = input;

    // 1. Defensively re-validate the range (Req 6.10). The parse layer already
    //    enforces start <= end, but the service must not trust its caller.
    if (start !== undefined && end !== undefined && start.getTime() > end.getTime()) {
      const fields: FieldError[] = [
        { field: 'range', reason: 'start must be less than or equal to end' },
      ];
      throw new ValidationError(fields);
    }

    // 2. Clamp the page size to [1, 100], defaulting to 25 (Req 6.8, 6.9).
    const pageSize = clampPageSize(input.pageSize);

    // 3. Compute the datastore offset from the 1-based page.
    const offset = (page - 1) * pageSize;

    // 4. Delegate the filtered/paged read and matching count, then assemble the
    //    response. Ordering is guaranteed by the repository.
    const filter: ActivityFilter = {};
    if (eventType !== undefined) {
      filter.eventType = eventType;
    }
    if (start !== undefined) {
      filter.start = start;
    }
    if (end !== undefined) {
      filter.end = end;
    }

    const [events, total] = await Promise.all([
      adminRepo.listActivity({ ...filter, limit: pageSize, offset }),
      adminRepo.countActivity(filter),
    ]);

    return {
      events,
      pagination: { page, pageSize, total },
    };
  }

  return { listActivity };
}

/**
 * Default Admin_Activity_Service instance wired to the real
 * {@link adminRepository}. Controllers import this for production use; tests
 * should prefer {@link createAdminActivityService} with an injected fake.
 */
export const adminActivityService = createAdminActivityService();

export default createAdminActivityService;
