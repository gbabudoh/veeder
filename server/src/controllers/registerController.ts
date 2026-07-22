/**
 * Register controller.
 *
 * Design reference: `design.md` → "Components and Interfaces" (Services →
 * Registration_Service), "Error Handling", and the `POST /register` row of
 * "Endpoint Contracts".
 *
 * HTTP responsibilities only — all business logic lives in the
 * {@link RegistrationService}. The controller:
 *
 * 1. Delegates the raw request body to `registrationService.register` (which
 *    validates, normalizes, hashes, and persists transactionally).
 * 2. On success responds `201` with `{ id, email }` — never the password hash
 *    (Req 1.4, 1.6). The service already excludes the hash from its result.
 * 3. On any thrown error, forwards it to `next(err)` so the centralized error
 *    handler maps it to the correct status: `ValidationError` → 400 (Req 1.7),
 *    `ConflictError` → 409 (Req 1.5), and unhandled/datastore failures →
 *    `InternalError` 500 (Req 1.8). Rate limiting (429, Req 8.3/8.4) is enforced
 *    by middleware ahead of this controller and never reaches it.
 *
 * A dependency-injecting factory ({@link createRegisterController}) lets tests
 * supply a mock service; the default export {@link registerController} is wired
 * to the real {@link registrationService} for production use.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  registrationService as defaultRegistrationService,
  type RegistrationService,
} from '../services/registrationService';

/**
 * Create a register controller bound to the given (optional) service.
 *
 * With no argument it uses the real {@link registrationService}. Injecting a
 * mock service makes the controller unit-testable without a datastore.
 *
 * The returned handler is async and wraps its body in try/catch so any rejected
 * promise reaches `next(err)` and is handled by the centralized error handler
 * rather than surfacing as an unhandled rejection.
 */
export function createRegisterController(
  service: RegistrationService = defaultRegistrationService,
): RequestHandler {
  return async function registerController(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result = await service.register(req.body);
      // 201 with only id + normalized email; the password hash is excluded by
      // the service and never included here (Req 1.4, 1.6).
      res.status(201).json({ id: result.id, email: result.email });
    } catch (error) {
      // Forward to the centralized error handler, which maps ValidationError →
      // 400, ConflictError → 409, and anything else → 500 (Req 1.7, 1.5, 1.8).
      next(error);
    }
  };
}

/**
 * Default register controller wired to the real {@link registrationService}.
 * Mounted by `src/routes/register.ts`.
 */
export const registerController: RequestHandler = createRegisterController();

export default createRegisterController;
