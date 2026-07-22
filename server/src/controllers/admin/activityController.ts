/**
 * Admin activity-log (`GET /admin/activity`) controller.
 *
 * Design reference: `design.md` → "Admin controllers" and the
 * `GET /admin/activity` row of "Endpoint Contracts". Requirements 6.1, 6.2,
 * 8.1.
 *
 * A thin HTTP adapter that runs behind the auth + admin guards. It:
 *
 * 1. Validates and normalizes the query via {@link parseActivityQuery}
 *    (event-type set membership, timestamp format, `start <= end`, pagination);
 *    on failure it forwards a {@link ValidationError} (→ 400).
 * 2. Delegates the filtered/paged read to
 *    {@link adminActivityService.listActivity}, which returns the
 *    {@link ActivityLogResponse} DTO already shaped for the wire (secrets
 *    excluded at the repository/service layers — Req 8.1).
 * 3. Responds `200` with that DTO unchanged, or forwards any thrown/rejected
 *    error (including a defensive service-side range {@link ValidationError}) to
 *    `next(err)`.
 *
 * A dependency-injecting factory ({@link createActivityController}) lets tests
 * supply a stub service; the default export {@link activityController} is wired
 * to the real {@link adminActivityService}.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ValidationError } from '../../errors';
import { parseActivityQuery } from '../../validation/adminQuery';
import {
  adminActivityService as defaultAdminActivityService,
  type AdminActivityService,
} from '../../services/adminActivityService';

/**
 * Create an admin activity-log controller bound to the given (optional) activity
 * service. Injecting a stub service makes the controller unit-testable without
 * a datastore.
 */
export function createActivityController(
  service: Pick<AdminActivityService, 'listActivity'> = defaultAdminActivityService,
): RequestHandler {
  return async function activityController(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const parsed = parseActivityQuery(req.query);
      if (!parsed.ok) {
        next(new ValidationError(parsed.fields));
        return;
      }

      const result = await service.listActivity(parsed.value);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Default admin activity-log controller wired to the real
 * {@link adminActivityService}. Mounted by `src/routes/admin.ts` behind the
 * auth + admin guards.
 */
export const activityController: RequestHandler = createActivityController();

export default createActivityController;
