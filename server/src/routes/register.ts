/**
 * Registration route.
 *
 * Design reference: `design.md` → "Middleware Pipeline (ordering matters)" and
 * the `POST /register` row of "Endpoint Contracts".
 *
 * Exposes an Express {@link Router} mounting `POST /` so the app can mount this
 * router at `/register` (task 16.1), yielding the `POST /register` contract.
 *
 * Ordering is a security requirement: the {@link registrationRateLimiter} runs
 * BEFORE the controller so an over-limit request is rejected with `429` and its
 * registration attempt is never processed (Req 8.3, 8.4). Only when the request
 * is within the per-IP window does control reach {@link registerController},
 * which delegates to the Registration_Service and responds `201 { id, email }`
 * (Req 1.4, 1.6).
 */

import { Router } from 'express';
import { registrationRateLimiter } from '../middleware/rateLimit';
import { registerController } from '../controllers/registerController';

/**
 * Build the registration router.
 *
 * Rate limiting is registered ahead of the controller so the limiter short-
 * circuits over-limit requests before any registration work occurs (Req 8.3,
 * 8.4).
 */
export function createRegisterRouter(): Router {
  const router = Router();
  router.post('/', registrationRateLimiter, registerController);
  return router;
}

/** Configured registration router, mounted at `/register` by the app. */
export const registerRouter: Router = createRegisterRouter();

export default registerRouter;
