/**
 * Admin API routes: `GET /admin/users`, `/admin/users/:id`, `/admin/activity`,
 * and `/admin/analytics` (all protected + admin-only).
 *
 * Design reference: `design.md` → "Admin controllers, routes, and app mount"
 * and the `/admin/*` rows of "Endpoint Contracts". Requirements 3.2, 3.3, 3.5,
 * 6.11.
 *
 * Mirroring the `/me` router, the middleware pipeline is applied at the router
 * level so it guards every admin endpoint uniformly:
 *
 *   1. {@link authGuard} — verifies the access token first; any missing/invalid/
 *      expired/malformed token short-circuits to a 401 before an admin decision
 *      is ever made (Req 3.2, 3.5). On the accepted path it attaches
 *      `req.userId` and `req.userRole`.
 *   2. {@link createAdminGuard} — allows the request iff `req.userRole ===
 *      'admin'`, otherwise forwards a 403 `admin_required`; both outcomes are
 *      audited via the injected {@link adminAccessLogger} (Req 3.3, 9.1, 9.2).
 *
 * Only after both guards pass does a request reach a controller, so a rejected
 * request never exposes any administrative data (Req 6.11). The router is
 * mounted at `/admin` by the application assembly.
 */

import { Router } from 'express';

import { authGuard } from '../middleware/authGuard';
import { createAdminGuard } from '../middleware/adminGuard';
import { adminAccessLogger } from '../services/adminAccessLogger';
import { usersListController } from '../controllers/admin/usersListController';
import { userDetailController } from '../controllers/admin/userDetailController';
import { activityController } from '../controllers/admin/activityController';
import { analyticsController } from '../controllers/admin/analyticsController';

/** Express router exposing the protected, admin-only `/admin/*` endpoints. */
export const adminRouter: Router = Router();

// Guard pipeline (order matters): authenticate first (Req 3.2, 3.5), then
// authorize as admin with audit logging (Req 3.3, 9.1, 9.2).
adminRouter.use(authGuard);
adminRouter.use(createAdminGuard({ accessLogger: adminAccessLogger }));

// Admin endpoints — reached only when both guards pass (Req 6.11).
adminRouter.get('/users', usersListController); //      GET /admin/users
adminRouter.get('/users/:id', userDetailController); // GET /admin/users/:id
adminRouter.get('/activity', activityController); //    GET /admin/activity
adminRouter.get('/analytics', analyticsController); //  GET /admin/analytics

export default adminRouter;
