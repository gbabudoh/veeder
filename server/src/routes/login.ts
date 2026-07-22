/**
 * Login route.
 *
 * Design reference: `design.md` → "Middleware Pipeline (ordering matters)" and
 * the `POST /login` row of "Endpoint Contracts".
 *
 * Wires the login endpoint as an Express `Router` mounted at `/login` by the
 * app assembly (task 16.1). The router registers a single `POST /` handler with
 * the login rate limiter placed BEFORE the controller so an over-limit request
 * is short-circuited with `429` and never reaches the authentication logic
 * (Req 8.1, 8.2). The controller then delegates to the Auth_Service and responds
 * `200 { accessToken, refreshToken }` on success (Req 3.1, 3.4).
 */

import { Router } from 'express';
import { loginController } from '../controllers/loginController';
import { loginRateLimiter } from '../middleware/rateLimit';

/**
 * Router for the login endpoint. Mount at `/login`:
 *
 *   app.use('/login', loginRouter);
 *
 * The rate limiter runs first (Req 8.1, 8.2), then the controller handles the
 * request (Req 3.1, 3.4).
 */
const router: Router = Router();

router.post('/', loginRateLimiter, loginController);

export default router;
