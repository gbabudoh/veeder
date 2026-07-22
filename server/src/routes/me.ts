/**
 * Current-user route: `GET /me` (protected).
 *
 * Design reference: `design.md` → the `GET /me` row of "Endpoint Contracts" and
 * the middleware pipeline. Requirements 7.1, 7.2, 7.5 (and 6.1–6.5 via the guard).
 *
 * This is the only Protected_Endpoint in the service. The {@link authGuard}
 * middleware runs BEFORE the controller so the access token is verified first
 * (Req 6.1): only an accepted token lets the request reach {@link meController}
 * (which then reads `req.userId`); every other outcome short-circuits to a `401`
 * without touching any resource (Req 6.2–6.5). The controller returns
 * `200 { id, email }` on success or `404` when the account no longer exists
 * (Req 7.1, 7.5), always excluding the password hash (Req 7.2).
 *
 * The router is mounted at `/me` by the application assembly (task 16.1), so the
 * handler is registered at the router root (`GET /`).
 */

import { Router } from 'express';

import { authGuard } from '../middleware/authGuard';
import { meController } from '../controllers/meController';

/** Express router exposing the protected `GET /me` endpoint. */
export const meRouter: Router = Router();

// Auth guard first (Req 6.1), then the controller — the guard populates
// `req.userId` for the controller on the accepted path only.
meRouter.get('/', authGuard, meController);

export default meRouter;
