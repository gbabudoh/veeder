/**
 * Admin analytics (`GET /admin/analytics`) controller.
 *
 * Design reference: `design.md` → "Admin controllers" and the
 * `GET /admin/analytics` row of "Endpoint Contracts". Requirements 7.1, 8.1.
 *
 * A thin HTTP adapter that runs behind the auth + admin guards. It:
 *
 * 1. Validates and normalizes the query via {@link parseAnalyticsQuery}
 *    (timestamp format, `start <= end`, span ≤ 366 days, `interval === 'day'`);
 *    on failure it forwards a {@link ValidationError} (→ 400). Defaulting of the
 *    range is the service's responsibility.
 * 2. Delegates the aggregate computation to
 *    {@link adminAnalyticsService.getAnalytics}, which returns the
 *    {@link AnalyticsResponse} DTO already shaped for the wire (secrets excluded
 *    at the repository/service layers — Req 8.1).
 * 3. Responds `200` with that DTO unchanged, or forwards any thrown/rejected
 *    error (including a defensive service-side range {@link ValidationError}) to
 *    `next(err)`.
 *
 * A dependency-injecting factory ({@link createAnalyticsController}) lets tests
 * supply a stub service; the default export {@link analyticsController} is wired
 * to the real {@link adminAnalyticsService}.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ValidationError } from '../../errors';
import { parseAnalyticsQuery } from '../../validation/adminQuery';
import {
  adminAnalyticsService as defaultAdminAnalyticsService,
  type AdminAnalyticsService,
} from '../../services/adminAnalyticsService';

/**
 * Create an admin analytics controller bound to the given (optional) analytics
 * service. Injecting a stub service makes the controller unit-testable without
 * a datastore.
 */
export function createAnalyticsController(
  service: Pick<AdminAnalyticsService, 'getAnalytics'> = defaultAdminAnalyticsService,
): RequestHandler {
  return async function analyticsController(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const parsed = parseAnalyticsQuery(req.query);
      if (!parsed.ok) {
        next(new ValidationError(parsed.fields));
        return;
      }

      const result = await service.getAnalytics(parsed.value);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Default admin analytics controller wired to the real
 * {@link adminAnalyticsService}. Mounted by `src/routes/admin.ts` behind the
 * auth + admin guards.
 */
export const analyticsController: RequestHandler = createAnalyticsController();

export default createAnalyticsController;
