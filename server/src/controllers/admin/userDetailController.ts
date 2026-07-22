/**
 * Admin user-detail (`GET /admin/users/:id`) controller.
 *
 * Design reference: `design.md` → "Admin controllers" and the
 * `GET /admin/users/:id` row of "Endpoint Contracts". Requirements 5.1, 5.4,
 * 8.1.
 *
 * A thin HTTP adapter that runs behind the auth + admin guards. It:
 *
 * 1. Validates the `:id` path parameter as a well-formed UUID via
 *    {@link parseUuidParam} without touching the datastore; on failure it
 *    forwards a {@link ValidationError} (→ 400).
 * 2. Optionally reads `activityPage`/`activityPageSize` from the query, passing
 *    each through only when it is a valid 1-based positive integer (clamping is
 *    the service's responsibility, so structurally invalid values are simply
 *    omitted rather than rejected).
 * 3. Delegates to {@link adminUsersService.getUserDetail}. A `null` result means
 *    no user has that id → {@link NotFoundError} (→ 404); otherwise it responds
 *    `200` with the {@link UserDetailResponse} DTO unchanged (secrets excluded
 *    at the repository/service layers — Req 5.4, 8.1).
 * 4. Forwards any thrown/rejected error to `next(err)`.
 *
 * A dependency-injecting factory ({@link createUserDetailController}) lets tests
 * supply a stub service; the default export {@link userDetailController} is
 * wired to the real {@link adminUsersService}.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { NotFoundError, ValidationError } from '../../errors';
import { parseUuidParam } from '../../validation/adminQuery';
import {
  adminUsersService as defaultAdminUsersService,
  type AdminUsersService,
  type GetUserDetailInput,
} from '../../services/adminUsersService';

/** Only digits, no sign, decimal point, or whitespace. */
const INTEGER_PATTERN = /^\d+$/;

/**
 * Parse an optional 1-based positive-integer query parameter, returning the
 * parsed value only when it is a valid positive integer and `undefined`
 * otherwise. The service clamps/defaults the value, so an invalid input is
 * passed through as "unset" rather than rejected here.
 */
function readPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!INTEGER_PATTERN.test(trimmed)) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }
  return parsed;
}

/**
 * Create an admin user-detail controller bound to the given (optional) users
 * service. Injecting a stub service makes the controller unit-testable without
 * a datastore.
 */
export function createUserDetailController(
  service: Pick<AdminUsersService, 'getUserDetail'> = defaultAdminUsersService,
): RequestHandler {
  return async function userDetailController(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const parsed = parseUuidParam(req.params.id);
      if (!parsed.ok) {
        next(new ValidationError(parsed.fields));
        return;
      }

      const input: GetUserDetailInput = { id: parsed.value.id };
      const activityPage = readPositiveInt(req.query.activityPage);
      if (activityPage !== undefined) {
        input.activityPage = activityPage;
      }
      const activityPageSize = readPositiveInt(req.query.activityPageSize);
      if (activityPageSize !== undefined) {
        input.activityPageSize = activityPageSize;
      }

      const result = await service.getUserDetail(input);
      if (result === null) {
        next(new NotFoundError());
        return;
      }

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Default admin user-detail controller wired to the real
 * {@link adminUsersService}. Mounted by `src/routes/admin.ts` behind the auth +
 * admin guards.
 */
export const userDetailController: RequestHandler = createUserDetailController();

export default createUserDetailController;
