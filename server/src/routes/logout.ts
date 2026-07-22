/**
 * Logout route.
 *
 * Design reference: `design.md` → "Endpoint Contracts" (the `POST /logout` row:
 * request `{ refreshToken }`, response `200 {}` always) and the routes diagram
 * (`Routes (/register /login /refresh /logout /me)`).
 *
 * Mounts `POST /` on a dedicated router; the app composition (`src/app.ts`)
 * mounts this router at `/logout`, yielding `POST /logout`. Logout is not rate
 * limited and requires no access token — it always responds `200` (Req 5.2).
 */

import { Router } from 'express';
import { logoutController } from '../controllers/logoutController';

/** Router exposing `POST /logout` (mounted at `/logout` by the app). */
export const logoutRouter: Router = Router();

logoutRouter.post('/', logoutController);

export default logoutRouter;
