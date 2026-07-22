/**
 * Refresh route — `POST /refresh`.
 *
 * Design reference: `design.md` → endpoint contract `POST /refresh`. Wires the
 * refresh controller onto an Express `Router`. No rate limiter is applied: the
 * spec only rate-limits the login and registration endpoints (Req 8), so the
 * refresh route has none.
 *
 * The controller is injected for tests; it defaults to the application's
 * {@link refreshController}, which resolves the default token manager lazily so
 * importing this module never loads configuration.
 */

import { Router, type RequestHandler } from 'express';

import { refreshController } from '../controllers/refreshController';

/** Options for {@link createRefreshRouter}. */
export interface RefreshRouterOptions {
  /** Controller handling the refresh request. Defaults to {@link refreshController}. */
  controller?: RequestHandler;
}

/**
 * Create the refresh router mounting `POST /` (mounted at `/refresh` by the app).
 *
 * @param options optional dependency overrides (a controller for tests).
 */
export function createRefreshRouter(options?: RefreshRouterOptions): Router {
  const controller = options?.controller ?? refreshController;

  const router = Router();
  router.post('/', controller);
  return router;
}

/**
 * Default refresh router bound to the default controller. The app mounts this at
 * `/refresh` so the effective endpoint is `POST /refresh`.
 */
export const refreshRouter: Router = createRefreshRouter();

export default createRefreshRouter;
