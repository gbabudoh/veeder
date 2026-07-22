# Implementation Plan: user-registration-backend

## Overview

This plan implements the user-registration-backend as a self-contained Node.js + Express +
TypeScript service under a new `server/` directory at the repository root (sibling to the existing
React Native app; the mobile app requires no changes). Work proceeds bottom-up: tooling and
configuration first, then database migrations, then the layered implementation
(repositories → services/support → middleware → controllers → routes), and finally app assembly,
bootstrap, and integration tests.

Property-based tests (fast-check + Jest) implement the design's 28 correctness properties and are
placed next to the code they validate. Each property test is a single test running a minimum of 100
iterations and is tagged with its design property number and the requirements it validates. All test
sub-tasks are marked optional with `*`.

## Tasks

- [x] 1. Set up the `server/` package and tooling
  - [x] 1.1 Initialize the server package and TypeScript configuration
    - Create `server/package.json` with Express 4, pg, knex, argon2, jsonwebtoken, zod, express-rate-limit, and pino as dependencies
    - Create `server/tsconfig.json` (strict mode) and the source folder layout (`src/config`, `src/validation`, `src/security`, `src/repositories`, `src/services`, `src/middleware`, `src/controllers`, `src/routes`, `src/errors`, `src/db`)
    - Add build/start/test npm scripts and a `.gitignore`/`.env.example` for the server package
    - _Requirements: 10.1_
  - [x]* 1.2 Configure the test toolchain (Jest + supertest + fast-check)
    - Add `jest.config` (ts-jest), install supertest and fast-check, wire `test` scripts
    - Add a test bootstrap that loads a `test` env and configures fast-check to run a minimum of 100 iterations
    - _Requirements: 10.1_
  - [x] 1.3 Configure Knex and the database connection module
    - Create `server/knexfile.ts` (connection string from env, migrations directory) and `src/db/knex.ts` exporting a shared Knex instance
    - Add migrate/rollback npm scripts
    - _Requirements: 3.3, 10.3, 11.1_

- [x] 2. Implement configuration loading and startup validation
  - [x] 2.1 Implement the config loader with the signing-key gate
    - Create `src/config/index.ts` implementing `loadConfig(env)` returning typed `AppConfig` with fixed constants (access 900s, refresh 2,592,000s, login 10/60s, registration 5/60s)
    - Derive `httpsRequired` from `APP_ENV`, read `JWT_SIGNING_KEY`, database connection string, and `trustProxyHops`
    - Throw and abort when `JWT_SIGNING_KEY` is missing or shorter than 32 characters
    - _Requirements: 10.1, 10.2_
  - [-]* 2.2 Write property test for the signing-key length gate
    - **Property 22: Signing-key length gate**
    - **Validates: Requirements 10.2**

- [x] 3. Create database migrations
  - [x] 3.1 Create the `users` table migration
    - id (uuid pk), email (text), password_hash (text), created_at (timestamptz); unique index on email
    - _Requirements: 1.1, 1.3, 1.5, 2.6_
  - [x] 3.2 Create the `refresh_tokens` table migration
    - id, user_id fk, family_id, token_hash (unique), revoked, expires_at, created_at, replaced_by; family and user indexes
    - _Requirements: 3.3, 4.2, 4.6, 10.3_
  - [x] 3.3 Create the `auth_events` table migration
    - id, event_type (checked enum), user_id fk (nullable), email, source_ip, occurred_at; type/time and user indexes
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 4. Implement the error taxonomy and centralized error handler
  - [x] 4.1 Implement typed error classes and error-body types
    - Create `src/errors/index.ts` with `ValidationError`, `AuthenticationError`, `TokenError`, `ConflictError`, `NotFoundError`, `RateLimitError`, `InternalError`, each carrying HTTP status and machine `code`; define `ErrorBody` and `FieldError`
    - _Requirements: 9.1_
  - [x] 4.2 Implement the centralized Express error handler
    - Create `src/middleware/errorHandler.ts` that maps typed errors to the `ErrorBody` shape, emits `500`/`internal_error` for unhandled errors, and never leaks stack traces or internals
    - _Requirements: 9.1, 9.2_
  - [-]* 4.3 Write property test for well-formed, safe error bodies
    - **Property 21: Every error response has a well-formed, safe body**
    - **Validates: Requirements 9.1, 9.2**

- [x] 5. Implement the validation component
  - [x] 5.1 Implement zod schemas and validators with email normalization
    - Create `src/validation/index.ts` with `validateRegistration`, `validateLogin`, `validateRefresh` returning a normalized value or a `FieldError[]` list (one entry per failed field); trim + lowercase email before uniqueness/persistence
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.6, 4.5, 9.4_
  - [-]* 5.2 Write property test for field-accurate validation errors
    - **Property 4: Validation reports exactly the fields that failed**
    - **Validates: Requirements 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 9.4**
  - [-]* 5.3 Write unit tests for login and refresh validation edge cases
    - Missing/empty/over-length login fields → malformed; missing/empty refresh token → required
    - _Requirements: 3.6, 4.5_

- [x] 6. Implement the password hasher
  - [x] 6.1 Implement the argon2id password hasher
    - Create `src/security/passwordHasher.ts` with `hash` (argon2id) and `verify`
    - _Requirements: 1.2, 3.1_
  - [-]* 6.2 Write unit tests for hash and verify
    - Hash differs from plaintext; verify succeeds for correct password and fails for incorrect
    - _Requirements: 1.2, 3.1_

- [x] 7. Implement repositories
  - [x] 7.1 Implement the users repository
    - Create `src/repositories/usersRepository.ts` with `findByEmail`, `insert` (unique email, tx-aware), `findById`
    - _Requirements: 1.1, 1.3, 1.5, 7.1, 7.5_
  - [x] 7.2 Implement the refresh-tokens repository
    - Create `src/repositories/refreshTokensRepository.ts` with `insert` (stores token_hash only), `findByHash`, `revokeById`, `revokeFamily`
    - _Requirements: 3.3, 4.2, 4.6, 10.3_
  - [x] 7.3 Implement the auth-events repository
    - Create `src/repositories/authEventsRepository.ts` with `insert`
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 8. Implement the token manager
  - [x] 8.1 Implement access-token issuance and verification
    - Create `src/security/tokenManager.ts` with `issueAccessToken` (exp = now + 900) and `verifyAccessToken` classifying to accepted / missing / invalid / expired / malformed
    - _Requirements: 3.2, 4.1, 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ]* 8.2 Write property test for access-token expiry
    - **Property 8: Access token expiry is always issuance + 900s**
    - **Validates: Requirements 3.2, 4.1**
  - [ ]* 8.3 Write property test for access-token guard classification
    - **Property 17: Access token guard classifies every token to exactly one outcome**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 7.3, 7.4**
  - [x] 8.4 Implement refresh-token issuance (opaque, hashed persistence)
    - Add `issueRefreshToken`: generate a CSPRNG opaque token, persist only its SHA-256 hash with `expires_at = created_at + 2,592,000`, and persist before returning; return plaintext once
    - _Requirements: 3.3, 10.3_
  - [ ]* 8.5 Write property test for hash-only refresh persistence
    - **Property 23: Refresh tokens are persisted only as a one-way hash**
    - **Validates: Requirements 10.3**
  - [ ]* 8.6 Write property test for refresh expiry and persist-before-return
    - **Property 9: Refresh token expiry is issuance + 2,592,000s and persisted before return**
    - **Validates: Requirements 3.3**
  - [x] 8.7 Implement refresh rotation, reuse detection, and revocation
    - Add `rotateRefreshToken` (revoke presented token, issue successor sharing family id; on reuse revoke the whole family and return `reuse`) and `revokeRefreshToken`, all inside a transaction
    - _Requirements: 4.1, 4.2, 4.4, 4.6, 5.1_
  - [ ]* 8.8 Write property test for rotation behavior
    - **Property 12: Refresh rotation revokes the old token and issues a valid successor**
    - **Validates: Requirements 4.1, 4.2, 4.3**
  - [ ]* 8.9 Write property test for invalid refresh rejection
    - **Property 13: Invalid refresh tokens are rejected**
    - **Validates: Requirements 4.4, 4.5**
  - [ ]* 8.10 Write property test for reuse family revocation
    - **Property 14: Reuse of a rotated refresh token revokes the entire family**
    - **Validates: Requirements 4.6**

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement the audit logger
  - [x] 10.1 Implement the audit logger with retry and non-blocking failure
    - Create `src/services/auditLogger.ts` wrapping the auth-events repository with retry-up-to-3, UTC timestamps, placeholder IP when unknown, one record per trigger, and no secret/token values
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_
  - [ ]* 10.2 Write property test for auth-event required fields
    - **Property 26: Auth events are recorded with the required fields**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5**
  - [ ]* 10.3 Write property test for secret-free auth events
    - **Property 27: Persisted auth events contain no secrets**
    - **Validates: Requirements 11.6**
  - [ ]* 10.4 Write property test for one event per trigger
    - **Property 28: One event per applicable trigger**
    - **Validates: Requirements 11.7**
  - [ ]* 10.5 Write unit test for retry-then-non-blocking behavior
    - Failing insert retried exactly 3 times, then a non-blocking indication; originating operation is not interrupted
    - _Requirements: 11.8_

- [x] 11. Implement the registration service
  - [x] 11.1 Implement the transactional registration service
    - Create `src/services/registrationService.ts`: validate, normalize email, check uniqueness, hash password, insert user + `registration` auth event in a transaction (rollback leaves no partial user); return id + normalized email; map duplicates to `409` and datastore failure to `500`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.6, 9.3, 11.1_
  - [ ]* 11.2 Write property test for retrievable account creation
    - **Property 1: Valid registration creates a retrievable account**
    - **Validates: Requirements 1.1, 1.4**
  - [ ]* 11.3 Write property test for verifying-hash-only password storage
    - **Property 2: Passwords are stored only as a verifying hash**
    - **Validates: Requirements 1.2, 1.3**
  - [ ]* 11.4 Write property test for email-normalization identity
    - **Property 5: Email normalization determines identity**
    - **Validates: Requirements 2.6, 1.5**
  - [ ]* 11.5 Write property test for non-disclosing duplicate rejection
    - **Property 6: Duplicate registration is rejected without disclosure**
    - **Validates: Requirements 1.5**
  - [ ]* 11.6 Write unit test for datastore failure during registration
    - Repository throws inside the transaction → `500`, no partial user persisted
    - _Requirements: 1.8, 9.3_

- [x] 12. Implement the auth service (login and logout)
  - [x] 12.1 Implement login with token issuance and auth-event logging
    - Create `src/services/authService.ts` login: verify credentials, issue one access + one refresh token (refresh persisted before return; `500` on persist failure), write `login-success`/`login-failure` events; generic `401` on bad credentials
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 11.2, 11.3_
  - [ ]* 12.2 Write property test for single access + single refresh on login
    - **Property 7: Successful login issues exactly one access and one refresh token**
    - **Validates: Requirements 3.1, 3.4**
  - [ ]* 12.3 Write property test for generic failed login
    - **Property 10: Failed login is generic and issues no tokens**
    - **Validates: Requirements 3.5**
  - [ ]* 12.4 Write property test for malformed-login short-circuit
    - **Property 11: Malformed login is rejected before credential verification**
    - **Validates: Requirements 3.6**
  - [x] 12.5 Implement logout with best-effort revocation
    - Add logout to the auth service: revoke a valid active refresh token and write a `logout` event; always return `200` for valid/revoked/absent/malformed tokens and on write failure leave stored state unchanged
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 11.4_
  - [ ]* 12.6 Write property test for logout revocation and always-200
    - **Property 15: Logout revokes the active token and always returns 200**
    - **Validates: Requirements 5.1, 5.2, 5.3**
  - [ ]* 12.7 Write property test for revoked-token refusal on refresh
    - **Property 16: A revoked refresh token cannot be refreshed**
    - **Validates: Requirements 5.4**
  - [ ]* 12.8 Write unit tests for login persist failure and logout write failure
    - Refresh persist failure at login → `500`, no tokens (Req 3.7); logout revocation write failure → `200`, state unchanged (Req 5.5)
    - _Requirements: 3.7, 5.5_

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement the middleware pipeline
  - [x] 14.1 Implement HTTPS enforcement middleware
    - Create `src/middleware/httpsEnforcement.ts` rejecting non-HTTPS requests in non-local environments and passing through in local/test
    - _Requirements: 10.4_
  - [ ]* 14.2 Write property test for HTTPS enforcement
    - **Property 24: HTTPS is enforced in non-local environments**
    - **Validates: Requirements 10.4**
  - [x] 14.3 Implement request logging with secret redaction
    - Create `src/middleware/requestLogger.ts` using pino with a redaction serializer that replaces `password`, `accessToken`, and `refreshToken` values anywhere in the payload with a fixed placeholder
    - _Requirements: 10.5_
  - [ ]* 14.4 Write property test for log redaction
    - **Property 25: Log output redacts secrets**
    - **Validates: Requirements 10.5**
  - [x] 14.5 Implement per-route rate limiting
    - Create `src/middleware/rateLimit.ts` with express-rate-limit (login 10/60s, registration 5/60s) keyed by source IP, returning `429` with an integer `Retry-After` in [1,60] and not processing the attempt
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [ ]* 14.6 Write property test for rate-limit boundaries
    - **Property 20: Rate limiting enforces the per-endpoint boundary**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
  - [x] 14.7 Implement the access-token auth guard middleware
    - Create `src/middleware/authGuard.ts` that verifies the `Authorization: Bearer` access token and throws the appropriate `TokenError` (missing/invalid/expired/malformed) without modifying any resource
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 15. Implement controllers and routes
  - [x] 15.1 Implement the register controller and route
    - Create `src/controllers/registerController.ts` and `src/routes/register.ts` wiring validation, the registration service, and the registration rate limiter; respond `201 { id, email }`
    - _Requirements: 1.4, 1.6, 1.7, 1.8, 8.3, 8.4_
  - [x] 15.2 Implement the login controller and route
    - Create `src/controllers/loginController.ts` and `src/routes/login.ts` wiring validation, the auth service, and the login rate limiter; respond `200 { accessToken, refreshToken }`
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 8.1, 8.2_
  - [x] 15.3 Implement the refresh controller and route
    - Create `src/controllers/refreshController.ts` and `src/routes/refresh.ts` invoking `rotateRefreshToken`; respond `200` with new tokens, `400` missing, `401` invalid/reuse
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 15.4 Implement the logout controller and route
    - Create `src/controllers/logoutController.ts` and `src/routes/logout.ts`; always respond `200`
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 15.5 Implement the current-user controller and protected route
    - Create `src/controllers/meController.ts` and `src/routes/me.ts` behind the auth guard; respond `200 { id, email }`, `404` when the account no longer exists, excluding the password hash
    - _Requirements: 7.1, 7.2, 7.5_
  - [ ]* 15.6 Write property test for profile round-trip
    - **Property 18: Profile round-trip returns the caller's own account**
    - **Validates: Requirements 7.1**
  - [ ]* 15.7 Write property test for valid token on a deleted account
    - **Property 19: Valid token for a deleted account returns 404**
    - **Validates: Requirements 7.5**
  - [ ]* 15.8 Write property test for password-free responses
    - **Property 3: Hashed password is never present in responses**
    - **Validates: Requirements 1.6, 7.2**

- [x] 16. Assemble the application and bootstrap the server
  - [x] 16.1 Assemble the Express app with the ordered middleware pipeline
    - Create `src/app.ts` composing middleware in order (HTTPS enforcement → request logging → body parsing → rate limiting → routes/auth guard → error handler) and mounting all routes; configure `trust proxy`
    - _Requirements: 6.1, 8.1, 8.3, 9.1, 9.2, 10.4, 10.5_
  - [x] 16.2 Implement the server bootstrap with startup validation
    - Create `src/server.ts` (or `src/index.ts`) that calls `loadConfig`, verifies database connectivity, aborts non-zero on missing/short signing key, and only then binds the HTTP listener
    - _Requirements: 10.1, 10.2_
  - [ ]* 16.3 Write integration tests for endpoint happy paths (supertest)
    - Full HTTP flows for register/login/refresh/logout/me against the real app with migrations applied to a disposable test database
    - _Requirements: 1.4, 3.4, 4.3, 5.2, 7.1_
  - [ ]* 16.4 Write integration tests for latency bounds and audit-write failure
    - Assert login/refresh/logout/me respond within 2 seconds; assert auth-event write failure retries 3 times without failing the operation
    - _Requirements: 3.4, 4.3, 5.1, 7.1, 11.8_

- [x] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP.
- The backend lives entirely under `server/`; the React Native app is not modified.
- Each task references specific requirements sub-clauses for traceability; property tests additionally
  reference their design property number.
- Property-based tests use fast-check + Jest, run a minimum of 100 iterations, and are tagged with a
  comment of the form `// Feature: user-registration-backend, Property {number}: {property_text}`.
- Pure-logic property tests (config gate, validation, token TTL math, redaction) run without a
  database; token-store, service, and endpoint properties run against a disposable test PostgreSQL
  database with migrations applied and truncated between tests.
- Checkpoints ensure incremental validation at natural boundaries.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1", "3.2", "3.3", "4.1", "5.1", "6.1"] },
    { "id": 3, "tasks": ["2.2", "4.2", "5.2", "5.3", "6.2", "7.1", "7.2", "7.3", "8.1"] },
    { "id": 4, "tasks": ["4.3", "8.2", "8.3", "8.4"] },
    { "id": 5, "tasks": ["8.5", "8.6", "8.7", "10.1"] },
    { "id": 6, "tasks": ["8.8", "8.9", "8.10", "10.2", "10.3", "10.4", "10.5", "11.1", "12.1"] },
    { "id": 7, "tasks": ["11.2", "11.3", "11.4", "11.5", "11.6", "12.2", "12.3", "12.4", "12.5"] },
    { "id": 8, "tasks": ["12.6", "12.7", "12.8", "14.1", "14.3", "14.5", "14.7"] },
    { "id": 9, "tasks": ["14.2", "14.4", "14.6", "15.1", "15.2", "15.3", "15.4", "15.5"] },
    { "id": 10, "tasks": ["16.1"] },
    { "id": 11, "tasks": ["16.2", "15.6", "15.7", "15.8"] },
    { "id": 12, "tasks": ["16.3", "16.4"] }
  ]
}
```
