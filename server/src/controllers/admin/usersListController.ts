/**
 * Admin user-list (`GET /admin/users`) controller.
 *
 * Design reference: `design.md` → "Admin controllers" and the `GET /admin/users`
 * row of "Endpoint Contracts". Requirements 4.1, 4.5, 4.6, 8.1.
 *
 * A thin HTTP adapter that runs behind the auth + admin guards on the protected
 * route. It:
 *
 * 1. Validates and normalizes the query via {@link parseUsersQuery}; on failure
 *    it forwards a {@link ValidationError} carrying the field-level failures to
 *    the centralized error handler (→ 400).
 * 2. Delegates the filtered/paged read to {@link adminUsersService.listUsers},
 *    which returns the {@link UserListResponse} DTO already shaped for the wire
 *    (secrets excluded at the repository/service layers — Req 4.5, 8.1).
 * 3. Responds `200` with that DTO unchanged, or forwards any thrown/rejected
 *    error to `next(err)`.
 *
 * A dependency-injecting factory ({@link createUsersListController}) lets tests
 * supply a stub service; the default export {@link usersListController} is wired
 * to the real {@link adminUsersService}.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ValidationError } from '../../errors';
import { parseUsersQuery } from '../../validation/adminQuery';
import {
  adminUsersService as defaultAdminUsersService,
  type AdminUsersService,
} from '../../services/adminUsersService';

/**
 * Create an admin user-list controller bound to the given (optional) users
 * service. Injecting a stub service makes the controller unit-testable without
 * a datastore.
 */
export function createUsersListController(
  service: Pick<AdminUsersService, 'listUsers'> = defaultAdminUsersService,
): RequestHandler {
  return async function usersListController(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const parsed = parseUsersQuery(req.query);
      if (!parsed.ok) {
        next(new ValidationError(parsed.fields));
        return;
      }

      const result = await service.listUsers(parsed.value);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Default admin user-list controller wired to the real {@link adminUsersService}.
 * Mounted by `src/routes/admin.ts` behind the auth + admin guards.
 */
export const usersListController: RequestHandler = createUsersListController();

export default createUsersListController;
