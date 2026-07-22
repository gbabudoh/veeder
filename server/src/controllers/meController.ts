/**
 * Current-user (`GET /me`) controller.
 *
 * Design reference: `design.md` → "Current User Profile" and the `GET /me` row
 * of "Endpoint Contracts". Requirements 7.1, 7.2, 7.5.
 *
 * HTTP responsibilities only. The auth guard (task 14.7) runs ahead of this
 * controller on the protected route and, on success, attaches the authenticated
 * User_Account id to `req.userId` (Req 6.1). This controller then:
 *
 * 1. Resolves the authenticated user id from `req.userId`. Because the route is
 *    guarded, it is present on every request that reaches here; defensively, an
 *    absent id is treated as an authentication failure via
 *    `next(new TokenError('missing'))` → 401 rather than trusting an unknown
 *    identity.
 * 2. Loads the account with `usersRepository.findById`. A `null` result means a
 *    valid token references an account that no longer exists → `404`
 *    (`NotFoundError`, Req 7.5).
 * 3. On success responds `200` with `{ id, email }` only — the password hash is
 *    never included in the response (Req 7.2).
 * 4. Forwards any thrown/rejected error to `next(err)` so the centralized error
 *    handler maps it (e.g. datastore failure → 500).
 *
 * A dependency-injecting factory ({@link createMeController}) lets tests supply
 * a mock repository; the default export {@link meController} is wired to the
 * real {@link usersRepository} for production use.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { NotFoundError, TokenError } from '../errors';
import {
  usersRepository as defaultUsersRepository,
  type UserRecord,
} from '../repositories/usersRepository';

/**
 * The minimal users-repository surface this controller depends on: a single
 * id lookup. Narrowing to just `findById` keeps the injected test double small.
 */
export interface MeUsersRepository {
  findById(id: string): Promise<UserRecord | null>;
}

/**
 * Create a current-user controller bound to the given (optional) users
 * repository.
 *
 * With no argument it uses the real {@link usersRepository}. Injecting a mock
 * repository makes the controller unit-testable without a datastore.
 *
 * The returned handler is async and wraps its body in try/catch so any rejected
 * promise reaches `next(err)` and is handled by the centralized error handler
 * rather than surfacing as an unhandled rejection.
 */
export function createMeController(
  usersRepo: MeUsersRepository = defaultUsersRepository,
): RequestHandler {
  return async function meController(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const userId = req.userId;
      if (userId === undefined) {
        // Should not happen behind the auth guard, but never trust an unknown
        // identity: surface a 401 rather than proceeding (Req 7.3).
        next(new TokenError('missing'));
        return;
      }

      const user = await usersRepo.findById(userId);
      if (user === null) {
        // Valid token, but the referenced account is gone → 404 (Req 7.5).
        next(new NotFoundError());
        return;
      }

      // 200 with only id + normalized email; the password hash is excluded here
      // and never leaves the service (Req 7.1, 7.2).
      res.status(200).json({ id: user.id, email: user.email });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Default current-user controller wired to the real {@link usersRepository}.
 * Mounted by `src/routes/me.ts` behind the auth guard.
 */
export const meController: RequestHandler = createMeController();

export default createMeController;
