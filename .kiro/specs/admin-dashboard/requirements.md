# Requirements Document

## Introduction

This document specifies the requirements for the **admin-dashboard** feature. The feature has two
parts that are delivered together in this single spec:

1. **Backend additions** to the existing `user-registration-backend` service (the Node.js + Express +
   TypeScript server in the repository's `server/` directory, backed by PostgreSQL via Knex). These
   additions introduce an admin role/permission model, role-based authorization, and a set of
   read-focused admin API endpoints that expose user management, activity-log viewing, and analytics
   aggregates.

2. **A new, separate React web application** (its own package in an `admin-dashboard/` directory at
   the repository root, written in TypeScript) that lets an administrator sign in, browse and search
   users, inspect a single user's activity, view the authentication activity log with filters, and
   review analytics. The web app talks to the backend admin API over HTTPS.

This spec builds directly on the existing authentication foundation. It **reuses** the existing JWT
access/refresh token mechanism, the existing `users`, `refresh_tokens`, and `auth_events` tables, the
existing structured `ErrorBody` error shape, rate limiting, and pino logging with secret redaction.
The existing service currently has **no** role concept and **no** admin endpoints; this spec adds a
`role` column to `users`, role-based authorization middleware, and the admin endpoints.

Requirements are grouped into two labeled sections — **Backend Requirements** and **Frontend
Requirements** — because the feature spans both a Node/Express API extension and a separate React app.
Where a frontend requirement depends on backend behavior, the dependency is called out.

### In Scope

**Backend (extends the existing `server/` service):**

- An admin role model: a `role` column on `users` (`'user'` or `'admin'`, default `'user'`) via a
  reversible migration, plus a mechanism to designate an administrator.
- Role-based authorization middleware that restricts admin endpoints to authenticated admins.
- Admin API endpoints: list/search/paginate users; view a single user's detail and activity;
  list/filter/paginate authentication events (activity log); and analytics aggregates (registration
  and login counts over time, active-user counts, login success vs. failure rates).
- Pagination, filtering, and bounded result sizes on list endpoints.
- Exclusion of secrets (password hashes, token values) from every admin response.
- Audit logging of admin activity consistent with the existing service.

**Frontend (new separate React web app):**

- Admin login screen authenticating against the backend (admin role required).
- Authenticated session handling: storing and refreshing tokens, and logout.
- Screens: users list (search + pagination), user detail with activity, activity-log view (filter by
  event type and date range), and an analytics overview with charts/metrics.
- Handling of unauthorized (non-admin) access and of loading, empty, and error states.
- HTTPS communication with the backend admin API.

### Out of Scope

- The veeder React Native mobile application (unchanged).
- The media-share feature.
- Non-admin end-user features and any change to the existing register/login/refresh/logout/me
  behavior beyond adding the `role` claim and column.

## Glossary

- **Admin_API**: The subset of the Backend_Service that exposes admin-only HTTP endpoints defined by this spec.
- **Backend_Service**: The existing Node.js + Express (TypeScript) server-side application that this spec extends.
- **Dashboard_App**: The new, separate React (TypeScript) web application defined by this spec.
- **Administrator**: A User_Account whose Role is `admin`.
- **Role**: A persisted attribute of a User_Account with the value `user` or `admin`.
- **Authorization_Middleware**: The Backend_Service component that verifies the requester is an Administrator before an Admin_API endpoint is processed.
- **User_Account**: A persisted record representing a registered user, as defined by the user-registration-backend spec, extended by this spec with a Role attribute.
- **Auth_Event**: A recorded authentication-related occurrence persisted in the `auth_events` table (type is one of registration, login-success, login-failure, logout).
- **Access_Token**: The short-lived (15-minute) JWT issued by the Backend_Service to authenticate API requests.
- **Refresh_Token**: The long-lived rotating credential issued by the Backend_Service to obtain a new Access_Token.
- **Admin_Session**: The Dashboard_App state representing a signed-in Administrator, including the current Access_Token and Refresh_Token.
- **User_List_Response**: A paginated Admin_API response containing a page of user summary records plus pagination metadata.
- **Activity_Log_Response**: A paginated Admin_API response containing a page of Auth_Event records plus pagination metadata.
- **Analytics_Response**: An Admin_API response containing aggregate metrics over a requested time range.
- **Page_Size**: The maximum number of records returned in a single page of a list response.
- **Time_Range**: A pair of UTC timestamps (start, end) that bounds the records or aggregates a request applies to.
- **Error_Body**: The existing structured error response shape `{ error: { code, message, fields? } }` used by the Backend_Service.
- **Loading_State**: A Dashboard_App view state shown while a request to the Admin_API is in progress.
- **Empty_State**: A Dashboard_App view state shown when a successful Admin_API response contains zero records.
- **Error_State**: A Dashboard_App view state shown when an Admin_API request fails.

---

## Requirements

> **Backend Requirements (Requirements 1–9)** — additions to the existing `server/` Node/Express service.

### Requirement 1: Admin Role Model

**User Story:** As a backend operator, I want a role attribute on user accounts, so that administrators can be distinguished from ordinary users.

#### Acceptance Criteria

1. THE Backend_Service SHALL provide a reversible Datastore migration that adds a Role column to the `users` table constrained to exactly the two allowed values `user` and `admin`, with a default value of `user`, such that any attempt to persist a Role value outside this set is rejected and the row is not written.
2. WHEN the migration is applied to a `users` table containing existing rows, THE Backend_Service SHALL set the Role of every existing User_Account to `user` and SHALL leave the count and identity of existing rows unchanged.
3. WHEN the Registration_Service creates a User_Account, THE Backend_Service SHALL assign that User_Account the Role `user`.
4. THE Backend_Service SHALL provide an operator-invocable mechanism to set the Role of an identified existing User_Account to `admin`, and this mechanism SHALL NOT be reachable through any unauthenticated HTTP endpoint.
5. WHEN the operator-invocable mechanism sets the Role of an identified existing User_Account to `admin`, THE Backend_Service SHALL persist the new Role value and SHALL return a confirmation indicating the updated Role.
6. IF the operator-invocable mechanism is invoked for a User_Account identifier that does not match any existing User_Account, THEN THE Backend_Service SHALL reject the operation, SHALL leave all User_Account records unchanged, and SHALL return an error indication reporting that the target User_Account was not found.
7. IF the migration is rolled back, THEN THE Backend_Service SHALL remove the Role column from the `users` table and SHALL leave all other `users` columns and their values unchanged.

### Requirement 2: Role Claim in Access Tokens

**User Story:** As a backend operator, I want the access token to carry the account role, so that authorization decisions do not require an extra lookup on every request.

#### Acceptance Criteria

1. WHEN the Token_Manager issues an Access_Token for a User_Account, THE Token_Manager SHALL include exactly one Role claim in the Access_Token whose value equals the User_Account's current Role and is exactly one of the defined Role values (`user` or `admin`).
2. IF the Token_Manager issues an Access_Token for a User_Account that has no Role assigned, THEN THE Token_Manager SHALL set the Role claim value to `user`.
3. WHEN the Backend_Service successfully verifies an Access_Token that carries a Role claim, THE Backend_Service SHALL make the Role claim value available to the Authorization_Middleware for the current request before any authorization decision is made for that request.
4. IF the Backend_Service fails to verify an Access_Token, THEN THE Backend_Service SHALL NOT make any Role claim value available to the Authorization_Middleware for the current request.
5. IF a verified Access_Token does not contain a Role claim, OR contains a Role claim whose value is not one of the defined Role values (`user` or `admin`), THEN THE Authorization_Middleware SHALL treat the request as having the Role `user` and SHALL NOT treat the request as having the Role `admin`.

### Requirement 3: Admin Authorization Enforcement

**User Story:** As a backend operator, I want admin endpoints restricted to administrators, so that ordinary users cannot access administrative data.

#### Acceptance Criteria

1. WHEN a request to an Admin_API endpoint includes a valid, unexpired Access_Token whose Role claim value is exactly `admin`, THE Authorization_Middleware SHALL allow the request to be processed and SHALL reach an authorization decision within 1000 milliseconds of receiving the request.
2. IF a request to an Admin_API endpoint omits the Access_Token, THEN THE Admin_API SHALL respond with HTTP status 401 and an Error_Body indicating that authentication is required, and SHALL exclude all administrative data from the response body.
3. IF a request to an Admin_API endpoint includes a valid Access_Token whose Role claim value is exactly `user`, THEN THE Admin_API SHALL respond with HTTP status 403 and an Error_Body indicating that administrator privileges are required, and SHALL exclude all administrative data from the response body.
4. IF a request to an Admin_API endpoint includes a valid Access_Token whose Role claim is absent, empty, or not one of the defined Role values, THEN THE Admin_API SHALL respond with HTTP status 403 and an Error_Body indicating that administrator privileges are required, and SHALL exclude all administrative data from the response body.
5. IF a request to an Admin_API endpoint includes an Access_Token that is expired beyond a 60-second clock-skew allowance, malformed, or fails signature verification, THEN THE Admin_API SHALL respond with HTTP status 401 and an Error_Body indicating that the token is invalid, and SHALL exclude all administrative data from the response body.
6. WHEN the Authorization_Middleware rejects a request to an Admin_API endpoint, THE Admin_API SHALL exclude all administrative data from the response body.

### Requirement 4: List and Search Users

**User Story:** As an Administrator, I want to list and search users, so that I can find specific accounts to review.

#### Acceptance Criteria

1. WHEN the Admin_API receives an authorized request to list users, THE Admin_API SHALL respond with HTTP status 200 and a User_List_Response containing a page of user summary records ordered by account creation timestamp in descending order, with any ties broken by ascending User_Account identifier.
2. WHERE a request to list users includes a non-empty search term of 1 to 254 characters after leading and trailing whitespace is removed, THE Admin_API SHALL include in the User_List_Response only user summary records whose Email_Address contains the search term using a case-insensitive match.
3. IF a request to list users includes a search term that is empty or consists only of whitespace after trimming, THEN THE Admin_API SHALL treat the request as having no search term and return all matching user summary records subject to pagination.
4. IF a request to list users includes a search term longer than 254 characters after trimming, THEN THE Admin_API SHALL respond with HTTP status 400 and an Error_Body identifying the search term as the invalid parameter, and SHALL NOT alter any stored data.
5. WHEN the Admin_API returns a user summary record, THE Admin_API SHALL include the User_Account identifier, Email_Address, Role, and account creation timestamp, and SHALL exclude the hashed Password.
6. WHEN the Admin_API returns a User_List_Response, THE Admin_API SHALL include pagination metadata containing the current page indicator as a 1-based page number, the Page_Size, and the total count of records that match the request.
7. IF a request to list users specifies a 1-based page number that exceeds the number of pages available for the matching records, THEN THE Admin_API SHALL respond with HTTP status 200 and a User_List_Response containing zero user summary records together with the pagination metadata.
8. IF a request to list users specifies a Page_Size greater than 100, THEN THE Admin_API SHALL limit the returned page to 100 records.
9. IF a request to list users omits a Page_Size, THEN THE Admin_API SHALL return at most 25 records in the page.
10. IF a request to list users specifies pagination parameters that are non-numeric, negative, zero, or otherwise malformed, THEN THE Admin_API SHALL respond with HTTP status 400 and an Error_Body identifying the invalid parameter, and SHALL NOT alter any stored data.

### Requirement 5: View User Detail and Activity

**User Story:** As an Administrator, I want to view a single user's details and recent activity, so that I can investigate that account.

#### Acceptance Criteria

1. WHEN the Admin_API receives an authorized request for a User_Account identified by an existing identifier, THE Admin_API SHALL respond with HTTP status 200 and a body containing the User_Account identifier, Email_Address, Role, and account creation timestamp formatted as an ISO 8601 UTC timestamp.
2. WHEN the Admin_API returns a User_Account detail, THE Admin_API SHALL include a page of at most Page_Size Auth_Event records (default 20, maximum 100) associated with that User_Account, each containing the event type and occurrence timestamp, ordered from most recent to least recent occurrence timestamp with ties broken by descending Auth_Event identifier.
3. WHEN the Admin_API returns a User_Account detail for a User_Account that has no associated Auth_Event records, THE Admin_API SHALL respond with HTTP status 200 and an empty collection of Auth_Event records.
4. WHEN the Admin_API returns a User_Account detail, THE Admin_API SHALL exclude the hashed Password and all Refresh_Token values from the response body.
5. IF the Admin_API receives a request for a User_Account whose identifier is not a well-formed identifier, THEN THE Admin_API SHALL validate the identifier format without querying the Datastore and SHALL respond with HTTP status 400 and an Error_Body identifying the invalid identifier.
6. IF the Admin_API receives an authorized request whose identifier is well-formed but does not exist in the Datastore, THEN THE Admin_API SHALL respond with HTTP status 404 and an Error_Body indicating the account was not found.

### Requirement 6: View and Filter the Activity Log

**User Story:** As an Administrator, I want to view and filter the authentication activity log, so that I can monitor authentication events across the system.

#### Acceptance Criteria

1. WHEN the Admin_API receives an authorized request for the activity log, THE Admin_API SHALL respond with HTTP status 200 and an Activity_Log_Response containing a page of Auth_Event records ordered from most recent to least recent occurrence timestamp, breaking ties between records with identical occurrence timestamps by descending Auth_Event identifier.
2. WHEN the Admin_API returns an Auth_Event record, THE Admin_API SHALL include the event type, the associated User_Account identifier when present, the Email_Address when present, the source IP, and the occurrence timestamp in UTC.
3. WHERE a request for the activity log includes an event-type filter whose value is one of registration, login-success, login-failure, or logout, THE Admin_API SHALL include only Auth_Event records of the specified type.
4. WHERE a request for the activity log includes a Time_Range, THE Admin_API SHALL include only Auth_Event records whose occurrence timestamp is greater than or equal to the start and less than or equal to the end of the Time_Range.
5. WHEN the Admin_API returns an Activity_Log_Response, THE Admin_API SHALL include pagination metadata containing the current page indicator expressed as a 1-based page number, the Page_Size, and the total count of records that match the request.
6. IF a request for the activity log includes an event-type filter whose value is not one of the four defined event types, THEN THE Admin_API SHALL respond with HTTP status 400 and an Error_Body identifying the invalid filter value.
7. IF a request for the activity log includes a Time_Range whose start is later than its end, THEN THE Admin_API SHALL respond with HTTP status 400 and an Error_Body indicating that the Time_Range is invalid.
8. IF a request for the activity log specifies a Page_Size greater than 100, THEN THE Admin_API SHALL limit the returned page to 100 records.
9. WHERE a request for the activity log omits the Page_Size, THE Admin_API SHALL apply a default Page_Size of 25 records.
10. IF a request for the activity log specifies a 1-based page indicator greater than the number of pages needed to contain all matching records, THEN THE Admin_API SHALL respond with HTTP status 200 and an Activity_Log_Response containing zero Auth_Event records with pagination metadata reflecting the requested page and the total count of matching records.
11. IF the Admin_API receives an unauthorized request for the activity log, THEN THE Admin_API SHALL respond with HTTP status 401, SHALL return an Error_Body indicating that the request is not authorized, and SHALL NOT include any Auth_Event records.

### Requirement 7: Analytics Aggregates

**User Story:** As an Administrator, I want aggregate analytics over authentication activity, so that I can understand registration and login trends.

#### Acceptance Criteria

1. WHEN the Admin_API receives an authorized request for analytics over a Time_Range, THE Admin_API SHALL respond with HTTP status 200 and an Analytics_Response containing the count of registration events, the count of login-success events, and the count of login-failure events within the Time_Range, where each count is a non-negative integer.
2. WHEN the Admin_API returns an Analytics_Response, THE Admin_API SHALL include a login success rate computed as the count of login-success events divided by the sum of login-success and login-failure events within the Time_Range, expressed as a decimal value in the inclusive range 0 to 1 and rounded to 4 decimal places.
3. IF the sum of login-success and login-failure events within the Time_Range is zero, THEN THE Admin_API SHALL report the login success rate as the value 0 rather than performing a division.
4. WHEN the Admin_API returns an Analytics_Response, THE Admin_API SHALL include a count of active users defined as the number of distinct User_Account identifiers appearing in login-success events within the Time_Range, expressed as a non-negative integer.
5. WHEN the Admin_API returns an Analytics_Response over a Time_Range grouped by a requested interval of day, THE Admin_API SHALL include, for each 24-hour interval in the Time_Range, the interval start timestamp expressed in UTC and the counts of registration, login-success, and login-failure events within that interval.
6. IF a request for analytics omits a Time_Range, THEN THE Admin_API SHALL compute aggregates over the most recent 30 days ending at the current server time.
7. IF a request for analytics includes a Time_Range whose start is later than its end, THEN THE Admin_API SHALL respond with HTTP status 400 and an Error_Body indicating that the Time_Range is invalid, and SHALL not return an Analytics_Response.
8. IF a request for analytics includes a Time_Range whose span exceeds 366 days, THEN THE Admin_API SHALL respond with HTTP status 400 and an Error_Body indicating that the Time_Range exceeds the maximum allowed span, and SHALL not return an Analytics_Response.
9. IF a request for analytics specifies a grouping interval other than day, THEN THE Admin_API SHALL respond with HTTP status 400 and an Error_Body indicating that the requested interval is not supported, and SHALL not return an Analytics_Response.

### Requirement 8: Admin Response Security

**User Story:** As a backend operator, I want admin responses to exclude secrets and be transport-secured, so that administrative access does not leak credentials.

#### Acceptance Criteria

1. WHEN the Admin_API returns any response body, THE Admin_API SHALL exclude hashed Password values, Access_Token values, and Refresh_Token values from that response body, including any nested or embedded occurrences at any depth of the body.
2. WHERE the Backend_Service is deployed to a non-local environment, WHEN the Admin_API receives an inbound request that is not over HTTPS, THE Admin_API SHALL reject the request without processing it and without producing any side effect, and SHALL respond with an Error_Body indicating that HTTPS is required.
3. WHEN the Admin_API writes request or response data to log output, THE Admin_API SHALL exclude Password values, Access_Token values, and Refresh_Token values from that log output, substituting a single fixed, non-empty redaction placeholder in place of every such occurrence.
4. WHEN the Admin_API returns any error response, THE Admin_API SHALL use the existing Error_Body shape containing a non-empty machine-readable code of 1 to 64 characters and a non-empty human-readable message of 1 to 500 characters.

### Requirement 9: Admin Action Audit Logging

**User Story:** As a backend operator, I want administrative access recorded, so that I have an audit trail of who accessed administrative data.

#### Acceptance Criteria

1. WHEN the Authorization_Middleware allows an Administrator request to an Admin_API endpoint, THE Backend_Service SHALL record a log entry containing the Administrator's User_Account identifier, the requested endpoint path, the request's HTTP method, and a UTC timestamp in ISO 8601 format with at least millisecond precision.
2. WHEN the Authorization_Middleware rejects a request to an Admin_API endpoint with HTTP status 403, THE Backend_Service SHALL record a log entry containing the requesting User_Account identifier, the requested endpoint path, the request's HTTP method, and a UTC timestamp in ISO 8601 format with at least millisecond precision.
3. WHEN the Backend_Service records an admin access log entry, THE Backend_Service SHALL exclude Password values, Access_Token values, and Refresh_Token values from that log entry.
4. IF recording an admin access log entry fails, THEN THE Admin_API SHALL complete the originating request or rejection with its unchanged HTTP status and response body, without adding delay to or altering that response.

---

> **Frontend Requirements (Requirements 10–16)** — the new, separate React (TypeScript) web app in `admin-dashboard/`.

### Requirement 10: Admin Login Screen

**User Story:** As an Administrator, I want to sign in to the dashboard, so that I can access administrative views.

#### Acceptance Criteria

1. WHEN an Administrator submits the login form with a non-empty Email_Address and a non-empty Password, THE Dashboard_App SHALL send an authentication request to the Backend_Service over HTTPS and SHALL apply a request timeout of 30 seconds.
2. WHEN the Backend_Service responds to the login request with HTTP status 200 and the response identifies the authenticated User_Account Role as `admin`, THE Dashboard_App SHALL establish an Admin_Session from the received Access_Token and Refresh_Token and display the analytics overview view.
3. IF the Backend_Service responds to the login request with HTTP status 200 and the response identifies the authenticated User_Account Role as `user`, THEN THE Dashboard_App SHALL discard any received Access_Token and Refresh_Token, refrain from establishing an Admin_Session, and display a message indicating that administrator privileges are required.
4. IF the Backend_Service responds to the login request with HTTP status 401, THEN THE Dashboard_App SHALL display a message indicating that the credentials are invalid and SHALL NOT establish an Admin_Session.
5. IF the Administrator submits the login form with an empty Email_Address, an empty Password, or an Email_Address that does not match the pattern `local-part@domain` (exactly one `@`, at least one character before the `@`, and at least one `.` in the domain portion), THEN THE Dashboard_App SHALL display a field-level message identifying each invalid field and SHALL NOT send an authentication request.
6. WHILE the authentication request is in progress, THE Dashboard_App SHALL display a Loading_State and SHALL prevent submission of a second concurrent authentication request.
7. IF the Backend_Service does not respond to the login request within the 30-second timeout, or responds with an HTTP status other than 200 or 401, THEN THE Dashboard_App SHALL exit the Loading_State, display an Error_State with a message indicating that sign-in could not be completed and can be retried, and SHALL NOT establish an Admin_Session.

### Requirement 11: Admin Session Handling

**User Story:** As an Administrator, I want my session to persist and refresh automatically, so that I can work without repeatedly signing in.

#### Acceptance Criteria

1. WHEN the Dashboard_App establishes an Admin_Session, THE Dashboard_App SHALL store exactly one current Access_Token and one current Refresh_Token for use in subsequent Admin_API requests.
2. WHEN the Dashboard_App sends a request to the Admin_API, THE Dashboard_App SHALL include the current Access_Token in the request Authorization header.
3. IF an Admin_API request returns HTTP status 401 because the Access_Token is expired, THEN THE Dashboard_App SHALL request a new Access_Token using the stored Refresh_Token and SHALL retry the original request at most once with the new Access_Token.
4. IF a request that has already been retried once with a refreshed Access_Token again returns HTTP status 401, THEN THE Dashboard_App SHALL NOT attempt a further refresh or retry and SHALL surface the failure to the current view.
5. IF the token refresh request returns HTTP status 401, THEN THE Dashboard_App SHALL terminate the Admin_Session, discard the stored tokens, and display the login screen.
6. IF the token refresh request does not complete within 10 seconds or fails with a network error, THEN THE Dashboard_App SHALL terminate the Admin_Session, discard the stored tokens, and display the login screen.
7. WHEN the Administrator activates the logout control, THE Dashboard_App SHALL send a logout request to the Backend_Service, discard the stored Access_Token and Refresh_Token, and display the login screen.
8. IF an Admin_API request returns HTTP status 403, THEN THE Dashboard_App SHALL display a message indicating that administrator privileges are required and SHALL NOT retry the request.
9. WHILE a token refresh is already in progress, IF one or more additional Admin_API requests return HTTP status 401, THEN THE Dashboard_App SHALL wait for the single in-progress refresh to complete and reuse its resulting Access_Token rather than initiating additional refresh requests.

### Requirement 12: Users List View

**User Story:** As an Administrator, I want to browse and search the users list, so that I can locate accounts of interest.

#### Acceptance Criteria

1. WHEN the Administrator opens the users list view, THE Dashboard_App SHALL request the first page of users from the Admin_API using a Page_Size of 25 records and display each returned user summary record showing the Email_Address, Role, and account creation timestamp.
2. WHEN the Administrator submits a search term in the users list view, THE Dashboard_App SHALL request the first page of users from the Admin_API filtered by that search term using a Page_Size of 25 records and display the returned page.
3. WHILE the Administrator is entering a search term, THE Dashboard_App SHALL wait until 400 milliseconds have elapsed with no further input change before issuing the filtered request to the Admin_API.
4. IF a filtered users list response is received after a later filtered request for the same view has already been issued, THEN THE Dashboard_App SHALL discard the earlier response and display only the results of the most recently issued request.
5. WHEN the Administrator navigates to a different page in the users list view, THE Dashboard_App SHALL request the corresponding page from the Admin_API using a Page_Size of 25 records and display the returned records.
6. WHILE a users list request is in progress, THE Dashboard_App SHALL display a Loading_State.
7. IF a users list request returns a page containing zero records, THEN THE Dashboard_App SHALL display an Empty_State indicating that no users match the request and SHALL retain the current search term.
8. IF a users list request fails with a status other than 401 or 403, or does not receive a response within 10 seconds, THEN THE Dashboard_App SHALL display an Error_State with a retry control and SHALL retain the current search term and page selection.
9. WHEN the Administrator activates the retry control in the Error_State, THE Dashboard_App SHALL re-issue the most recently attempted users list request to the Admin_API using the retained search term and page selection.
10. WHEN the Administrator selects a user summary record, THE Dashboard_App SHALL display the user detail view for the selected User_Account.

### Requirement 13: User Detail View

**User Story:** As an Administrator, I want to see a single user's details and activity, so that I can investigate that account.

#### Acceptance Criteria

1. WHEN the Administrator opens the user detail view for a User_Account, THE Dashboard_App SHALL request that User_Account's detail and activity from the Admin_API with a request timeout of 30 seconds and, upon success, display the Email_Address, Role, account creation timestamp, and the returned Auth_Event records ordered from most recent to oldest.
2. WHILE the user detail request is in progress, THE Dashboard_App SHALL display a Loading_State until the request completes successfully, fails, or the 30-second timeout elapses.
3. WHEN the user detail request completes successfully and returns zero Auth_Event records, THE Dashboard_App SHALL display an Empty_State indicating that no activity is recorded for the User_Account.
4. IF the user detail request fails with HTTP status 404, THEN THE Dashboard_App SHALL display a message indicating that the User_Account was not found and SHALL NOT display any User_Account detail or Auth_Event records.
5. IF the user detail request fails with a status other than 401, 403, or 404, THEN THE Dashboard_App SHALL display an Error_State with a retry control that re-requests the User_Account's detail and activity from the Admin_API when activated.
6. IF the user detail request fails with HTTP status 401 or 403, THEN THE Dashboard_App SHALL display a message indicating that the Administrator is not authorized to view the User_Account and SHALL NOT display any User_Account detail or Auth_Event records.
7. IF the user detail request does not complete within the 30-second timeout, THEN THE Dashboard_App SHALL cancel the request and display an Error_State with a retry control that re-requests the User_Account's detail and activity from the Admin_API when activated.

### Requirement 14: Activity Log View

**User Story:** As an Administrator, I want to view and filter the activity log, so that I can monitor authentication events.

#### Acceptance Criteria

1. WHEN the Administrator opens the activity log view, THE Dashboard_App SHALL request the first page of up to 50 Auth_Event records from the Admin_API ordered by occurrence timestamp in descending order (most recent first) and display each record showing the event type, associated Email_Address when present, source IP, and occurrence timestamp.
2. WHEN the Administrator applies an event-type filter in the activity log view, THE Dashboard_App SHALL request the first page of up to 50 Auth_Event records filtered by the selected event type and display the returned page.
3. WHEN the Administrator applies a Time_Range filter in the activity log view, THE Dashboard_App SHALL request the first page of up to 50 Auth_Event records bounded by the selected Time_Range and display the returned page.
4. WHILE an activity log request is in progress, THE Dashboard_App SHALL display a Loading_State and SHALL prevent submission of any additional activity log request until the in-progress request completes.
5. IF an activity log request returns a page containing zero records, THEN THE Dashboard_App SHALL display an Empty_State indicating that no events match the filters.
6. IF the Administrator selects a Time_Range whose start is later than its end, THEN THE Dashboard_App SHALL send the activity log request with the selected Time_Range and SHALL display the validation message returned by the Admin_API when it responds with HTTP status 400.
7. IF an activity log request fails with a status other than 401 or 403, THEN THE Dashboard_App SHALL display an Error_State with a retry control that, when activated by the Administrator, re-sends the same activity log request using the currently applied filters.
8. WHEN the Administrator requests the next page of results in the activity log view, THE Dashboard_App SHALL request the subsequent page of up to 50 Auth_Event records using the currently applied filters and Time_Range and append the returned records to the displayed list in occurrence timestamp descending order.

### Requirement 15: Analytics Overview View

**User Story:** As an Administrator, I want an analytics overview, so that I can understand registration and login trends at a glance.

#### Acceptance Criteria

1. WHEN the Administrator opens the analytics overview view, THE Dashboard_App SHALL request analytics aggregates from the Admin_API for the selected Time_Range and, upon receiving a successful response, display the registration count, login-success count, login-failure count, login success rate, and active-user count.
2. WHEN the Dashboard_App displays the login success rate, THE Dashboard_App SHALL compute it as login-success count divided by the sum of login-success count and login-failure count, expressed as a percentage rounded to one decimal place, and SHALL display 0.0% when that sum is zero.
3. WHEN the Administrator opens the analytics overview view and no Time_Range has been selected, THE Dashboard_App SHALL default the selected Time_Range to the last 30 days.
4. WHEN the Dashboard_App receives analytics aggregates grouped by interval, THE Dashboard_App SHALL display a chart plotting registration, login-success, and login-failure counts across each interval of the selected Time_Range.
5. WHEN the Administrator changes the selected Time_Range in the analytics overview view, THE Dashboard_App SHALL request analytics aggregates for the new Time_Range and, upon receiving a successful response, update the displayed metrics and chart to reflect the new Time_Range.
6. WHILE an analytics request is in progress, THE Dashboard_App SHALL display a Loading_State and SHALL suppress display of the Empty_State and Error_State.
7. IF an analytics request returns aggregates in which the registration count, login-success count, login-failure count, and active-user count are all zero, THEN THE Dashboard_App SHALL display an Empty_State indicating that no activity is recorded for the selected Time_Range.
8. IF an analytics request fails with a status other than 401 or 403, or does not complete within 30 seconds, THEN THE Dashboard_App SHALL display an Error_State that indicates the request failed and SHALL present a retry control.
9. WHEN the Administrator activates the retry control in the Error_State, THE Dashboard_App SHALL re-request analytics aggregates for the selected Time_Range.

### Requirement 16: Unauthorized Access Handling

**User Story:** As a backend operator, I want the dashboard to prevent unauthorized use, so that only authenticated administrators reach administrative views.

#### Acceptance Criteria

1. IF the Administrator attempts to open any administrative view while no Admin_Session exists, THEN THE Dashboard_App SHALL display the login screen instead of the requested view and SHALL retain a reference to the originally requested view.
2. WHILE no Admin_Session exists, THE Dashboard_App SHALL block navigation to every view except the login screen, redirecting any such navigation attempt to the login screen.
3. WHEN the Dashboard_App communicates with the Backend_Service, THE Dashboard_App SHALL use request URLs that begin with the "https://" scheme.
4. IF a request to the Backend_Service is constructed with any scheme other than "https://", THEN THE Dashboard_App SHALL cancel the request without transmitting it and SHALL display an error indication that a secure connection is required, retaining the current view state.
5. WHEN the Administrator completes a successful login and an Admin_Session is established, THE Dashboard_App SHALL navigate to the originally requested view, or to the default administrative view if no originally requested view was retained.
6. WHEN the Dashboard_App transmits any Admin_Session token to the Backend_Service, THE Dashboard_App SHALL exclude the token from the request URL path and query string.
