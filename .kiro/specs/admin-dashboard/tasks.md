# Implementation Plan: admin-dashboard

## Overview

This plan implements the two coordinated deliverables from the design, in dependency order:

- **Deliverable A — Backend admin API** is layered into the existing `server/` service
  (Node/Express/TypeScript, Knex/Postgres, Jest + supertest + fast-check already configured).
  It is built **bottom-up** so each layer is a working prerequisite for the next: role
  migration + `usersRepository` role handling → access-token role claim + guards + errors →
  query validation → `adminRepository` → admin services → controllers + routes + `createApp`
  mount → `set-role` operator CLI → admin access audit logger.
- **Deliverable B — Admin dashboard web app** is a brand-new package in a new `admin-dashboard/`
  directory at the repo root (Vite + React + TypeScript, TanStack React Query, React Router,
  Axios, Recharts, Vitest + RTL + fast-check). It is built after the backend it talks to:
  project setup → api types + client + refresh coordinator + endpoints → session store +
  provider + protected route → React Query hooks → pages + shared components → routing + app
  bootstrap.

Property-based test sub-tasks (marked optional with `*`) map to the design's 27 correctness
properties and are placed next to the code they validate. Backend property/integration tests
reuse the `DATABASE_URL_TEST` test-database approach and guard DB-backed tests behind it;
frontend property tests use fast-check + Vitest against the pure modules with a mocked API.
The React Native mobile app is untouched.

New dependencies: the backend uses libraries already present in `server/package.json` (role
handling reuses `jsonwebtoken`, `zod`, `knex`); the frontend package is created from scratch and
installs its own dependencies under `admin-dashboard/`.

## Tasks

- [x] 1. Backend role model — migration and users repository
  - [x] 1.1 Create the reversible role migration
    - Add `server/src/db/migrations/20250101000004_add_role_to_users.ts`
    - `up`: add `role TEXT NOT NULL DEFAULT 'user'`; add explicitly-named CHECK constraint `users_role_check` restricting values to `('user','admin')`; existing rows backfill to `user` via the default (identity and count unchanged)
    - `down`: drop the `users_role_check` constraint (if exists) then drop the `role` column, leaving all other columns unchanged
    - _Requirements: 1.1, 1.2, 1.7_

  - [x] 1.2 Extend usersRepository with role support
    - Add `export type Role = 'user' | 'admin'`; add `role: Role` to `UserRecord` and map the `role` column (snake_case→camelCase)
    - Ensure inserts default new accounts to `role = 'user'` (registration assigns `user`)
    - Add `updateRole(id, role, trx?): Promise<UserRecord | null>` returning `null` when the id does not exist
    - _Requirements: 1.3, 1.5, 1.6_

  - [ ]* 1.3 Write property test for registration default role
    - **Property 1: Registration assigns the default role**
    - Uses `DATABASE_URL_TEST`; skip when unset
    - **Validates: Requirements 1.3**

  - [ ]* 1.4 Write property test for role update
    - **Property 2: Role update persists and is reported**
    - Uses `DATABASE_URL_TEST`; skip when unset
    - **Validates: Requirements 1.5**

  - [ ]* 1.5 Write integration test for the migration
    - Apply `up`/`down`; assert the CHECK rejects out-of-set values and that rollback removes only the `role` column
    - Uses `DATABASE_URL_TEST`; skip when unset
    - _Requirements: 1.1, 1.2, 1.7_

- [x] 2. Access-token role claim and issuance
  - [x] 2.1 Add the role claim to tokenManager
    - Change `issueAccessToken(userId, role)` to embed exactly one `role` claim; default to `'user'` when none supplied
    - Extend verification to return `role` on `accepted`, normalizing an absent/out-of-set claim to `'user'`
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [x] 2.2 Pass role when issuing access tokens
    - Update `authService` login issuance and `tokenManager` refresh rotation (`rotateWithin`) to look up the user's current role and pass it to `issueAccessToken`
    - _Requirements: 2.1_

  - [ ]* 2.3 Write property test for access-token role round-trip
    - **Property 3: Access-token role round-trip**
    - Runs against `createTokenManager` with injected config; no DB required
    - **Validates: Requirements 2.1, 2.3**

  - [ ]* 2.4 Write property test for role-claim normalization
    - **Property 4: Role-claim normalization to `user`**
    - **Validates: Requirements 2.2, 2.5**

- [x] 3. Errors and authorization guards
  - [x] 3.1 Add ForbiddenError to the errors taxonomy
    - Add a `ForbiddenError` `AppError` subclass mapping to HTTP 403 with code `admin_required`
    - _Requirements: 3.3, 3.4_

  - [x] 3.2 Extend authGuard to expose the verified role
    - On `accepted`, set `req.userId` and `req.userRole` together; on any verification failure attach neither (401 as today)
    - _Requirements: 2.3, 2.4_

  - [x] 3.3 Create the adminGuard middleware
    - Add `server/src/middleware/adminGuard.ts` exporting `createAdminGuard({ accessLogger? })`
    - Allow (call `next()`) iff `req.userRole === 'admin'`; otherwise forward `new ForbiddenError()` (403); decision is in-memory only (well under 1000 ms)
    - Invoke the injected access logger for allow and deny (wired in a later task)
    - _Requirements: 3.1, 3.3, 3.4_

  - [ ]* 3.4 Write property test for the authorization decision
    - **Property 5: Role-based authorization decision**
    - Runs against `createAdminGuard` with a stub request/next; no DB required
    - **Validates: Requirements 3.1, 3.3, 3.4**

- [x] 4. Admin query validation
  - [x] 4.1 Implement validation/adminQuery.ts
    - Add `server/src/validation/adminQuery.ts` using zod, returning the existing `ValidationResult`/`FieldError` shape
    - Parse pagination (`page`, `pageSize`), `search` (1–254 after trim), `eventType` (four allowed values), time range (`start`/`end` ISO-8601 UTC), and `interval` (`day`); validate `:id` as a UUID without touching the datastore; no validation path mutates data
    - _Requirements: 4.4, 4.10, 5.5, 6.6, 6.7, 7.7, 7.8, 7.9_

  - [ ]* 4.2 Write unit tests for adminQuery validation
    - Cover invalid pagination, over-254 search term, bad event type, `start > end`, span > 366 days, non-`day` interval, and malformed UUID
    - _Requirements: 4.4, 4.10, 5.5, 6.6, 6.7, 7.7, 7.8, 7.9_

- [x] 5. Admin repository
  - [x] 5.1 Implement repositories/adminRepository.ts
    - Add `server/src/repositories/adminRepository.ts` with `listUsers`, `countUsers`, `findUserSummaryById`, `listUserActivity`, `listActivity`, `countActivity`, `aggregateTotals`, `countActiveUsers`, `aggregatePerDay` (all transaction-aware, snake_case→camelCase mapped)
    - Never select `password_hash` or any token value; case-insensitive `ILIKE '%term%'` on email; order `created_at DESC, id ASC` for users and `occurred_at DESC, id DESC` for activity; per-day grouping via `date_trunc('day', occurred_at at time zone 'UTC')`
    - _Requirements: 4.1, 4.2, 5.2, 6.1, 6.3, 6.4, 7.1, 7.4, 7.5_

  - [ ]* 5.2 Write property test for list ordering
    - **Property 7: List ordering is deterministic**
    - Uses `DATABASE_URL_TEST`; skip when unset
    - **Validates: Requirements 4.1, 5.2, 6.1**

  - [ ]* 5.3 Write property test for user search filter
    - **Property 9: User search filter correctness**
    - Uses `DATABASE_URL_TEST`; skip when unset
    - **Validates: Requirements 4.2**

  - [ ]* 5.4 Write property test for activity event-type filter
    - **Property 10: Activity event-type filter correctness**
    - Uses `DATABASE_URL_TEST`; skip when unset
    - **Validates: Requirements 6.3**

  - [ ]* 5.5 Write property test for activity time-range filter
    - **Property 11: Activity time-range filter correctness**
    - Uses `DATABASE_URL_TEST`; skip when unset
    - **Validates: Requirements 6.4**

- [x] 6. Admin services
  - [x] 6.1 Implement adminUsersService
    - Add `server/src/services/adminUsersService.ts`: `listUsers` clamps `pageSize` to `[1,100]` (default 25), computes offset from the 1-based page, delegates filtered/paged + count queries, returns rows + `PaginationMeta`; `getUserDetail` returns the user summary plus a page of that user's events (default 20, max 100) or a not-found signal
    - _Requirements: 4.6, 4.7, 4.8, 4.9, 5.1, 5.2, 5.3, 5.6_

  - [x] 6.2 Implement adminActivityService
    - Add `server/src/services/adminActivityService.ts`: validate range (`start ≤ end`), clamp `pageSize` to `[1,100]` (default 25), return filtered/paged/ordered events + `PaginationMeta`
    - _Requirements: 6.5, 6.8, 6.9, 6.10_

  - [x] 6.3 Implement adminAnalyticsService
    - Add `server/src/services/adminAnalyticsService.ts`: default range to last 30 days; reject `start > end`, span > 366 days, and non-`day` interval; compute totals, success rate (`success/(success+failure)`, `0` when denominator 0, 4 dp, in `[0,1]`), active users (distinct login-success user ids), and the per-day series
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 6.4 Write property test for pagination invariants
    - **Property 8: Pagination invariants (clamping, defaults, totals, out-of-range)**
    - Uses an in-memory reference oracle; `DATABASE_URL_TEST` for repository-backed paths, skip when unset
    - **Validates: Requirements 4.6, 4.7, 4.8, 4.9, 5.2, 6.5, 6.8, 6.9, 6.10**

  - [ ]* 6.5 Write property test for analytics counts
    - **Property 13: Analytics counts match the range**
    - **Validates: Requirements 7.1**

  - [ ]* 6.6 Write property test for login success rate
    - **Property 14: Login success rate is a bounded, correctly-rounded ratio**
    - Pure computation; no DB required
    - **Validates: Requirements 7.2, 7.3**

  - [ ]* 6.7 Write property test for active-user count
    - **Property 15: Active users equals distinct login-success user ids**
    - **Validates: Requirements 7.4**

  - [ ]* 6.8 Write property test for per-day buckets
    - **Property 16: Per-day buckets partition the totals**
    - **Validates: Requirements 7.5**

- [x] 7. Admin access audit logger
  - [x] 7.1 Implement services/adminAccessLogger.ts
    - Add `server/src/services/adminAccessLogger.ts` with `recordAllowed(req)` and `recordDenied(req)` writing an entry with requester user id, endpoint path, HTTP method, and an ISO-8601 UTC millisecond timestamp via pino; never log secrets; swallow its own failures so it never alters or delays the originating response
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ]* 7.2 Write property test for log-entry completeness
    - **Property 18: Admin-access log entries are complete**
    - **Validates: Requirements 9.1, 9.2**

  - [ ]* 7.3 Write property test for non-blocking logging
    - **Property 19: Audit logging is non-blocking**
    - **Validates: Requirements 9.4**

- [x] 8. Admin controllers, routes, and app mount
  - [x] 8.1 Implement admin controllers with DTO mapping
    - Add `server/src/controllers/admin/usersListController.ts`, `userDetailController.ts`, `activityController.ts`, `analyticsController.ts`
    - Each: parse/validate query via `adminQuery`, call the service, map to the response DTO (`UserListResponse`, `UserDetailResponse`, `ActivityLogResponse`, `AnalyticsResponse` with `PaginationMeta`/`UserSummary`/`ActivityEntry`/`DailyBucket`) excluding all secrets, forward errors to the centralized handler
    - _Requirements: 4.1, 4.5, 4.6, 5.1, 5.4, 6.1, 6.2, 7.1, 8.1_

  - [x] 8.2 Create routes/admin.ts and mount into createApp
    - Add `server/src/routes/admin.ts`: `Router` with `authGuard` then `createAdminGuard({ accessLogger: adminAccessLogger })`, then `GET /users`, `/users/:id`, `/activity`, `/analytics`
    - Add `app.use('/admin', adminRouter)` in `createApp` after the existing HTTPS/logging/body-parsing middleware
    - _Requirements: 3.2, 3.3, 3.5, 6.11_

  - [ ]* 8.3 Write property test for secret exclusion
    - **Property 12: Secret exclusion in responses and access logs**
    - Deep-traversal assertion over response bodies and log entries
    - **Validates: Requirements 4.5, 5.4, 8.1, 9.3**

  - [ ]* 8.4 Write property test for rejected-request data exclusion
    - **Property 6: Rejected requests expose no administrative data**
    - Exercises missing/invalid/expired/malformed token and non-admin role via supertest against `createApp`
    - **Validates: Requirements 3.6, 6.11, 8.1**

  - [ ]* 8.5 Write property test for well-formed error bodies
    - **Property 17: Error bodies are well-formed**
    - **Validates: Requirements 8.4**

  - [ ]* 8.6 Write integration tests for the four endpoints
    - End-to-end through `createApp` including 200 success plus 400/401/403/404 paths and HTTPS enforcement for a non-local config; 1–3 representative cases each
    - Uses `DATABASE_URL_TEST`; skip when unset
    - _Requirements: 3.2, 3.3, 3.5, 4.1, 5.1, 5.6, 6.1, 7.1, 8.2_

- [x] 9. Operator role CLI
  - [x] 9.1 Implement scripts/setRole.ts and the set-role npm script
    - Add `server/src/scripts/setRole.ts` invoked as `npm run set-role -- <email> admin`: resolve user by trimmed/lowercased email, call `usersRepository.updateRole`, print a confirmation including the updated role on success; on unknown email print a not-found error, exit non-zero, and change nothing
    - Add `"set-role": "ts-node src/scripts/setRole.ts"` to `server/package.json` scripts
    - _Requirements: 1.4, 1.5, 1.6_

  - [ ]* 9.2 Write unit test for the set-role CLI
    - Assert unknown-email non-zero exit with no data change, and that the mechanism is not reachable via any HTTP route
    - _Requirements: 1.4, 1.6_

- [x] 10. Checkpoint — backend
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Frontend project setup (new admin-dashboard/ package)
  - [x] 11.1 Scaffold the Vite + React + TypeScript app
    - Create `admin-dashboard/` with `package.json`, `vite.config.ts`, `tsconfig.json`, and `index.html`; add and install dependencies: React 18, react-dom, @tanstack/react-query, react-router-dom, axios, recharts
    - _Requirements: 16.3_

  - [x] 11.2 Configure Vitest, React Testing Library, and fast-check
    - Add dev dependencies and a Vitest config with jsdom environment, RTL setup file, and React Query configured with retries disabled in tests
    - _Requirements: 16.3_

- [x] 12. Frontend API layer
  - [x] 12.1 Define api/types.ts mirroring backend DTOs
    - Add `admin-dashboard/src/api/types.ts` with `Role`, `PaginationMeta`, `UserSummary`, `UserListResponse`, `ActivityEntry`, `UserDetailResponse`, `ActivityLogResponse`, `DailyBucket`, `AnalyticsResponse`, and the `ErrorBody` shape
    - _Requirements: 11.1_

  - [x] 12.2 Implement api/refreshCoordinator.ts (pure single-flight)
    - Add `ensureRefresh(): Promise<string | null>` holding a single in-flight refresh promise so concurrent callers await the same refresh; a 10 s timeout, a 401, or a network error resolves the session-ended path (returns `null`)
    - Keep decision logic pure/injectable for property testing
    - _Requirements: 11.3, 11.4, 11.9_

  - [x] 12.3 Implement api/client.ts (axios + interceptors)
    - Add a single axios instance with `https://` `baseURL`; request interceptor rejects any resolved URL whose scheme is not `https://` and attaches the current access token in the `Authorization` header only (never URL/query)
    - Response interceptor: on 401 for a not-yet-retried non-refresh request, `await refreshCoordinator.ensureRefresh()` then retry once; on 401 for an already-retried request, surface failure; on 403, reject with an admin-privileges marker and no retry
    - _Requirements: 11.2, 11.3, 11.4, 11.8, 16.3, 16.4, 16.6_

  - [x] 12.4 Implement api/endpoints.ts
    - Add typed calls: `login`, `refresh`, `logout`, `users`, `userDetail`, `activity`, `analytics`, using the shared client and types
    - _Requirements: 10.1, 11.7, 12.1, 13.1, 14.1, 15.1_

  - [ ]* 12.5 Write property test for single-flight refresh
    - **Property 24: Single-flight refresh**
    - N concurrent 401s against a mocked refresh controlled by a deferred promise
    - **Validates: Requirements 11.9**

  - [ ]* 12.6 Write property test for refresh-and-retry-once
    - **Property 23: Refresh-and-retry at most once**
    - **Validates: Requirements 11.3, 11.4**

  - [ ]* 12.7 Write property test for transport safety
    - **Property 22: Transport safety (HTTPS, header-only tokens)**
    - **Validates: Requirements 11.2, 16.3, 16.6**

  - [ ]* 12.8 Write property test for no-retry-on-403
    - **Property 25: No retry on 403**
    - **Validates: Requirements 11.8**

- [x] 13. Frontend session and protected routing
  - [x] 13.1 Implement auth/sessionStore.ts
    - In-memory (module-scoped) store holding exactly one access token and one refresh token, with `setSession`, `clearSession`, `getAccessToken`, and a subscribe mechanism
    - _Requirements: 11.1_

  - [x] 13.2 Implement auth/SessionProvider.tsx
    - React context exposing the session plus `login`/`logout`; establish a session only when the authenticated role is `admin` (discard tokens and show privileges-required otherwise); logout calls `POST /logout`, clears tokens, and shows `/login`
    - _Requirements: 10.2, 10.3, 11.7_

  - [x] 13.3 Implement auth/ProtectedRoute.tsx
    - Wrap administrative routes; when no session exists, redirect to `/login` preserving the originally-requested location; block navigation to non-login views while unauthenticated
    - _Requirements: 16.1, 16.2, 16.5_

  - [ ]* 13.4 Write property test for the session store
    - **Property 21: Session stores exactly one token pair**
    - **Validates: Requirements 11.1**

  - [ ]* 13.5 Write property test for protected-route redirect and target
    - **Property 27: Protected-route redirect and post-login target**
    - **Validates: Requirements 16.1, 16.5**

- [x] 14. Frontend React Query hooks
  - [x] 14.1 Implement useUsers
    - Query `GET /admin/users` with `pageSize=25`; debounce search 400 ms; discard stale responses via query keys + cancellation; expose loading/empty/error and retry
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9_

  - [x] 14.2 Implement useUserDetail
    - Query `GET /admin/users/:id` with a 30 s timeout; distinguish 404 vs 401/403 vs other errors
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [x] 14.3 Implement useActivity (infinite)
    - `useInfiniteQuery` over `GET /admin/activity` with `pageSize=50`, appending pages in descending order; prevent concurrent requests while one is in-flight; surface API 400 range-validation message
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [x] 14.4 Implement useAnalytics and the success-rate formatter
    - Query `GET /admin/analytics`; default range last 30 days; derive the displayed success-rate percentage (1 dp, `0.0%` when denominator 0) and feed the per-day series to the chart
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9_

  - [ ]* 14.5 Write property test for success-rate display formatting
    - **Property 26: Success-rate display formatting**
    - Targets the pure formatter; no network required
    - **Validates: Requirements 15.2**

- [x] 15. Frontend pages and shared components
  - [x] 15.1 Implement shared state components
    - Add `LoadingState`, `EmptyState`, `ErrorState` (with retry control), `Chart` (Recharts wrapper), and `Pagination`
    - _Requirements: 12.6, 12.7, 12.8, 13.2, 13.3, 13.5, 14.4, 14.5, 14.7, 15.4, 15.6, 15.7, 15.8_

  - [x] 15.2 Implement LoginPage
    - Client-side field validation (non-empty email/password; email pattern with exactly one `@`, non-empty local part, and a `.` in domain) before sending; 30 s timeout; block double submit; map 200-admin / 200-user / 401 / other outcomes per Req 10
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [x] 15.3 Implement AnalyticsPage (default landing)
    - Render metrics and the per-day chart via `useAnalytics`; range selector; loading/empty/error states with retry
    - _Requirements: 15.1, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9_

  - [x] 15.4 Implement UsersListPage
    - Search + pagination via `useUsers`; row selection navigates to user detail; loading/empty/error with retry
    - _Requirements: 12.1, 12.2, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10_

  - [x] 15.5 Implement UserDetailPage
    - Show user summary + activity via `useUserDetail`; 404/not-authorized/empty/error states with retry
    - _Requirements: 13.1, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [x] 15.6 Implement ActivityLogPage
    - Event-type and time-range filters; infinite append via `useActivity`; empty/error with retry; show API 400 range message
    - _Requirements: 14.1, 14.2, 14.3, 14.5, 14.6, 14.7, 14.8_

  - [ ]* 15.7 Write property test for login field validation
    - **Property 20: Login email/field validation gates the request**
    - Targets the pure validation function; asserts no request is issued on invalid input
    - **Validates: Requirements 10.5**

  - [ ]* 15.8 Write component tests for pages
    - With a mocked API client (React Query retries disabled, fake timers for debounce): login outcomes/concurrency, users list wiring/pagination/empty/error/retry, user detail states, activity filters/infinite append, analytics render/range-change/empty/error/retry
    - _Requirements: 10.1, 10.4, 10.6, 10.7, 12.3, 12.5, 12.7, 12.8, 13.3, 13.5, 14.4, 14.5, 15.5, 15.7, 15.8_

- [x] 16. Frontend routing and app bootstrap
  - [x] 16.1 Implement routes.tsx
    - Public `/login`; `/`, `/users`, `/users/:id`, `/activity`, `/analytics` wrapped by `ProtectedRoute`; default landing `/analytics`
    - _Requirements: 16.1, 16.2, 16.5_

  - [x] 16.2 Implement main.tsx bootstrap
    - Mount `QueryClientProvider` + `SessionProvider` + `RouterProvider` and render the route table
    - _Requirements: 10.2, 16.2_

- [x] 17. Checkpoint — frontend and full feature
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (unit, property, and integration tests) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific granular requirements for traceability, and every property test task names the design property it validates.
- Backend property/integration tests reuse the real PostgreSQL test database via `DATABASE_URL_TEST` and are guarded to skip when it is unset; pure-logic property tests (Properties 3–6, 14–16) need no database.
- Frontend property tests use fast-check + Vitest against the pure modules (`refreshCoordinator`, `sessionStore`, client/endpoints transport, `ProtectedRoute`, login validation, success-rate formatter) with a mocked API client.
- Checkpoints provide incremental validation between the backend and frontend deliverables.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "3.1", "4.1", "11.1"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5", "2.2", "2.3", "2.4", "3.2", "4.2", "5.1", "11.2", "12.1"] },
    { "id": 2, "tasks": ["3.3", "5.2", "5.3", "5.4", "5.5", "6.1", "6.2", "6.3", "12.2", "13.1"] },
    { "id": 3, "tasks": ["3.4", "6.4", "6.5", "6.6", "6.7", "6.8", "7.1", "12.3", "13.2", "13.4"] },
    { "id": 4, "tasks": ["7.2", "7.3", "8.1", "9.1", "12.4", "12.5", "12.6", "12.7", "12.8", "13.3"] },
    { "id": 5, "tasks": ["8.2", "9.2", "13.5", "14.1", "14.2", "14.3", "14.4", "15.1"] },
    { "id": 6, "tasks": ["8.3", "8.4", "8.5", "8.6", "14.5", "15.2", "15.3", "15.4", "15.5", "15.6"] },
    { "id": 7, "tasks": ["15.7", "15.8", "16.1"] },
    { "id": 8, "tasks": ["16.2"] }
  ]
}
```
