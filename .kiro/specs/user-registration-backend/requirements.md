# Requirements Document

## Introduction

This document specifies the requirements for the **user-registration-backend**, a server-side
foundation for the existing "veeder" React Native mobile application. The backend is a Node.js +
Express service (TypeScript) backed by a PostgreSQL datastore. It provides user registration,
authentication, session/token management, input validation, structured error handling, security
fundamentals, and auth-event audit logging.

This is the first spec in a planned multi-spec effort. An admin dashboard (managing app activities,
user activities, and analytics) is explicitly **deferred to a separate follow-up spec and is out of
scope here**. The auth-event logging in this spec exists so a future analytics/dashboard effort can
build on it, but no dashboard or UI is included.

### In Scope

- Node.js + Express backend service written in TypeScript.
- PostgreSQL datastore (users table plus supporting tables such as refresh tokens and auth-event logs).
- User registration with email + password (validation, uniqueness, secure hashing).
- Authentication with JWT access tokens + refresh tokens.
- Core account endpoints: register, login, logout, refresh, and get current user profile.
- Input validation and structured error responses.
- Security fundamentals: password hashing, duplicate-account protection, rate limiting on auth
  endpoints, secure secret/token handling, and HTTPS transport expectations.
- Auth-event audit logging at the data layer.

### Out of Scope

- Admin dashboard UI and analytics visualizations (separate follow-up spec).
- The media-share feature (already implemented client-side).
- Mobile client UI changes (React Native integration is a noted dependency, not part of this spec).

## Glossary

- **Backend_Service**: The Node.js + Express (TypeScript) server-side application defined by this spec.
- **Auth_API**: The subset of the Backend_Service that exposes registration and authentication HTTP endpoints.
- **Registration_Service**: The Backend_Service component that handles new account creation.
- **Auth_Service**: The Backend_Service component that handles login, token issuance, refresh, and logout.
- **Validation_Component**: The Backend_Service component that validates incoming request payloads.
- **Password_Hasher**: The Backend_Service component that hashes and verifies passwords using bcrypt or argon2.
- **Token_Manager**: The Backend_Service component that generates, signs, and verifies JWT access tokens and refresh tokens.
- **Audit_Logger**: The Backend_Service component that records authentication events to the datastore.
- **Rate_Limiter**: The Backend_Service component that limits request frequency on authentication endpoints.
- **Datastore**: The PostgreSQL database used by the Backend_Service.
- **User_Account**: A persisted record representing a registered user, keyed by a unique identifier and email address.
- **Access_Token**: A short-lived JWT used to authenticate requests to protected endpoints.
- **Refresh_Token**: A long-lived credential used to obtain a new Access_Token without re-entering credentials.
- **Auth_Event**: A recorded authentication-related occurrence (for example: registration, login success, login failure, logout, token refresh).
- **Client**: The veeder React Native mobile application (React Native 0.86, TypeScript, Android/iOS) that consumes the Auth_API.
- **Protected_Endpoint**: Any Backend_Service endpoint that requires a valid Access_Token.
- **Email_Address**: A user-supplied identifier that conforms to RFC 5322 addr-spec format.
- **Password**: A user-supplied secret credential subject to the password policy defined in this document.

## Requirements

### Requirement 1: User Registration

**User Story:** As a new veeder user, I want to create an account with my email and password, so that I can access the app's features.

#### Acceptance Criteria

1. WHEN the Registration_Service receives a registration request containing an Email_Address that is non-empty, no longer than 254 characters, and matches the pattern local-part@domain (exactly one "@", at least one "." in the domain), and a Password that is between 8 and 128 characters inclusive, THE Registration_Service SHALL create a User_Account in the Datastore.
2. WHEN the Registration_Service creates a User_Account, THE Password_Hasher SHALL hash the Password using bcrypt or argon2 before the User_Account is persisted.
3. WHEN the Registration_Service persists a User_Account, THE Registration_Service SHALL store the hashed Password and SHALL exclude the plaintext Password from the Datastore.
4. WHEN the Registration_Service has fully persisted a User_Account in the Datastore, THE Auth_API SHALL respond with HTTP status 201 and a body containing the User_Account identifier and Email_Address, and SHALL return HTTP status 201 even if formatting of the response body fails.
5. IF the Registration_Service receives a registration request with an Email_Address that already exists in the Datastore, THEN THE Auth_API SHALL respond with HTTP status 409 and an error body indicating a duplicate account, without disclosing whether the existing password matched.
6. WHEN the Registration_Service successfully creates a User_Account, THE Auth_API SHALL exclude the hashed Password from the response body.
7. IF the Registration_Service receives a registration request in which the Email_Address fails the format or length rules in criterion 1, or the Password fails the length rules in criterion 1, THEN THE Auth_API SHALL respond with HTTP status 400, SHALL include an error body indicating which field is invalid, and SHALL NOT create a User_Account in the Datastore.
8. IF the Datastore is unavailable or the persistence operation fails while creating a User_Account, THEN THE Auth_API SHALL respond with HTTP status 500, SHALL include an error body indicating the account could not be created, and THE Registration_Service SHALL leave no partial User_Account in the Datastore.

### Requirement 2: Registration Input Validation

**User Story:** As a backend operator, I want registration inputs validated, so that only well-formed and policy-compliant accounts are created.

#### Acceptance Criteria

1. IF a registration request contains an Email_Address that does not conform to RFC 5322 addr-spec format, THEN THE Validation_Component SHALL reject the request without creating a User_Account and THE Auth_API SHALL respond with HTTP status 400 and a field-level error identifying the Email_Address.
2. IF a registration request contains an Email_Address longer than 254 characters, THEN THE Validation_Component SHALL reject the request without creating a User_Account and THE Auth_API SHALL respond with HTTP status 400 and a field-level error identifying the Email_Address.
3. IF a registration request contains a Password shorter than 8 characters or longer than 128 characters, THEN THE Validation_Component SHALL reject the request without creating a User_Account and THE Auth_API SHALL respond with HTTP status 400 and a field-level error identifying the Password.
4. IF a registration request omits the Email_Address field, omits the Password field, or provides either field as an empty string or a value containing only whitespace characters, THEN THE Validation_Component SHALL reject the request without creating a User_Account and THE Auth_API SHALL respond with HTTP status 400 and a field-level error identifying each such field.
5. IF a single registration request violates more than one of the validation rules in criteria 1 through 4, THEN THE Validation_Component SHALL reject the request without creating a User_Account and THE Auth_API SHALL respond with HTTP status 400 and a field-level error for each violated field in the same response.
6. WHEN the Validation_Component processes an Email_Address, THE Validation_Component SHALL remove leading and trailing whitespace and convert all alphabetic characters to lowercase before performing uniqueness checks and persistence.

### Requirement 3: User Login and Token Issuance

**User Story:** As a registered veeder user, I want to log in with my credentials, so that I receive tokens to access protected features.

#### Acceptance Criteria

1. WHEN the Auth_Service receives a login request whose Email_Address matches a User_Account and whose Password is verified against the stored hash by the Password_Hasher, THE Auth_Service SHALL issue exactly one Access_Token and exactly one Refresh_Token.
2. WHEN the Auth_Service issues an Access_Token, THE Token_Manager SHALL set the Access_Token expiry to 15 minutes (900 seconds) from the issuance timestamp.
3. WHEN the Auth_Service issues a Refresh_Token, THE Token_Manager SHALL set the Refresh_Token expiry to 30 days (2,592,000 seconds) from the issuance timestamp and SHALL persist the Refresh_Token record in the Datastore before the tokens are returned to the caller.
4. WHEN the Auth_Service successfully authenticates a login request, THE Auth_API SHALL respond with HTTP status 200 and a body containing the Access_Token and the Refresh_Token within 2 seconds of receiving the request.
5. IF the Auth_Service receives a login request whose Email_Address has no matching User_Account or whose Password fails verification, THEN THE Auth_API SHALL respond with HTTP status 401 and a generic authentication-failure error that does not disclose which field was incorrect, and SHALL NOT issue any Access_Token or Refresh_Token.
6. IF the Auth_Service receives a login request in which the Email_Address or the Password field is missing, empty, or exceeds 254 characters, THEN THE Auth_API SHALL respond with HTTP status 400 and an error indicating that the request is malformed, and SHALL NOT attempt credential verification.
7. IF the Token_Manager fails to persist the Refresh_Token record in the Datastore, THEN THE Auth_API SHALL respond with HTTP status 500 and an error indicating that token issuance failed, and SHALL NOT return any Access_Token or Refresh_Token to the caller.

### Requirement 4: Token Refresh

**User Story:** As a logged-in veeder user, I want to renew my access token using a refresh token, so that I stay signed in without re-entering my credentials.

#### Acceptance Criteria

1. WHEN the Token_Manager receives a refresh request containing a Refresh_Token that is present in the Datastore, unexpired, and not revoked, THE Token_Manager SHALL issue a new Access_Token that expires 900 seconds (15 minutes) after issuance.
2. WHEN the Token_Manager issues a new Access_Token from a valid Refresh_Token, THE Token_Manager SHALL rotate the Refresh_Token by revoking the presented Refresh_Token and persisting a new Refresh_Token that expires 2,592,000 seconds (30 days) after issuance.
3. WHEN the Token_Manager successfully refreshes tokens, THE Auth_API SHALL respond within 2 seconds with HTTP status 200 and a body containing the new Access_Token and the new Refresh_Token.
4. IF the Token_Manager receives a refresh request with a Refresh_Token that is absent from the Datastore, expired, or revoked, THEN THE Auth_API SHALL respond with HTTP status 401 and an error indicating the Refresh_Token is invalid, and THE Token_Manager SHALL NOT issue a new Access_Token or Refresh_Token.
5. IF the Token_Manager receives a refresh request in which the Refresh_Token field is missing or is an empty string, THEN THE Auth_API SHALL respond with HTTP status 400 and an error indicating the Refresh_Token is required, and THE Token_Manager SHALL NOT issue a new Access_Token or Refresh_Token.
6. IF the Token_Manager receives a refresh request containing a Refresh_Token that was previously revoked through rotation, THEN THE Token_Manager SHALL revoke all Refresh_Tokens associated with that User_Account in the Datastore, and THE Auth_API SHALL respond with HTTP status 401 and an error indicating the Refresh_Token is invalid.

### Requirement 5: Logout

**User Story:** As a logged-in veeder user, I want to log out, so that my refresh token can no longer be used.

#### Acceptance Criteria

1. WHEN the Auth_Service receives a logout request containing a valid, currently-active Refresh_Token, THE Auth_Service SHALL mark that Refresh_Token as revoked in the Datastore within 2 seconds of receiving the request.
2. WHEN the Auth_Service completes processing of a logout request, THE Auth_API SHALL respond with HTTP status 200 within 2 seconds regardless of whether the Refresh_Token was valid, already revoked, absent from the request, or whether the revocation write to the Datastore failed.
3. IF the Auth_Service receives a logout request in which the Refresh_Token is absent or malformed, THEN THE Auth_Service SHALL skip the Datastore revocation write and THE Auth_API SHALL still respond with HTTP status 200.
4. WHEN a Refresh_Token has been marked as revoked in the Datastore, THE Token_Manager SHALL reject any subsequent refresh request presenting that Refresh_Token with HTTP status 401 and a response body indicating that the Refresh_Token is invalid or revoked.
5. IF the Datastore revocation write fails during processing of a logout request, THEN THE Auth_Service SHALL leave the Refresh_Token's stored revocation state unchanged and THE Auth_API SHALL respond with HTTP status 200.

### Requirement 6: Request Authentication on Protected Endpoints

**User Story:** As a backend operator, I want protected endpoints to require valid tokens, so that only authenticated users access account resources.

#### Acceptance Criteria

1. WHEN a request to a Protected_Endpoint includes an Access_Token whose signature verifies against the signing key and whose expiration timestamp is later than the current server time, THE Backend_Service SHALL process the request for the associated User_Account.
2. IF a request to a Protected_Endpoint omits the Access_Token, THEN THE Backend_Service SHALL block processing of the request without modifying any User_Account resource and THE Auth_API SHALL respond with HTTP status 401 and an error indicating that authentication is required.
3. IF a request to a Protected_Endpoint includes an Access_Token whose signature fails verification against the signing key, THEN THE Backend_Service SHALL block processing of the request without modifying any User_Account resource and THE Auth_API SHALL respond with HTTP status 401 and an error indicating that the token is invalid.
4. IF a request to a Protected_Endpoint includes an Access_Token whose expiration timestamp is equal to or earlier than the current server time, THEN THE Backend_Service SHALL block processing of the request without modifying any User_Account resource and THE Auth_API SHALL respond with HTTP status 401 and an error indicating that the token is expired.
5. IF a request to a Protected_Endpoint includes an Access_Token that cannot be parsed as a well-formed token, THEN THE Backend_Service SHALL block processing of the request without modifying any User_Account resource and THE Auth_API SHALL respond with HTTP status 401 and an error indicating that the token is malformed.

### Requirement 7: Current User Profile

**User Story:** As a logged-in veeder user, I want to retrieve my own profile, so that the app can display my account details.

#### Acceptance Criteria

1. WHEN the Backend_Service receives a request for the current user profile accompanied by an Access_Token that is unexpired and successfully validated, THE Backend_Service SHALL respond within 2 seconds with HTTP status 200 and a body containing the requesting user's own User_Account identifier and Email_Address.
2. WHEN the Backend_Service returns a current user profile, THE Backend_Service SHALL exclude the hashed Password from the response body.
3. IF the Backend_Service receives a request for the current user profile with no Access_Token present, THEN THE Backend_Service SHALL respond with HTTP status 401 and an error indicating that authentication is required, and SHALL NOT return any User_Account data.
4. IF the Backend_Service receives a request for the current user profile with an Access_Token that is expired, malformed, or fails validation, THEN THE Backend_Service SHALL respond with HTTP status 401 and an error indicating that the token is invalid, and SHALL NOT return any User_Account data.
5. IF the Backend_Service receives a request for the current user profile with a valid Access_Token but the referenced User_Account no longer exists, THEN THE Backend_Service SHALL respond with HTTP status 404 and an error indicating the account was not found.

### Requirement 8: Rate Limiting and Abuse Protection

**User Story:** As a backend operator, I want authentication endpoints rate limited, so that brute-force and abuse attempts are curtailed.

#### Acceptance Criteria

1. WHILE a Client sends requests to the login endpoint, THE Rate_Limiter SHALL permit at most 10 requests per source IP address within any rolling 60-second window.
2. IF a source IP address exceeds 10 requests to the login endpoint within any rolling 60-second window, THEN THE Auth_API SHALL reject the request with HTTP status 429, include a Retry-After header specifying an integer number of seconds (1 to 60) until requests are permitted again, and not process the authentication attempt.
3. WHILE a Client sends requests to the registration endpoint, THE Rate_Limiter SHALL permit at most 5 requests per source IP address within any rolling 60-second window.
4. IF a source IP address exceeds 5 requests to the registration endpoint within any rolling 60-second window, THEN THE Auth_API SHALL reject the request with HTTP status 429, include a Retry-After header specifying an integer number of seconds (1 to 60) until requests are permitted again, and not process the registration attempt.

### Requirement 9: Structured Error Handling

**User Story:** As a Client developer, I want consistent error responses, so that the app can handle failures predictably.

#### Acceptance Criteria

1. WHEN the Auth_API returns any error response, THE Auth_API SHALL include a body containing a non-empty machine-readable error code field consisting of 1 to 64 characters and a non-empty human-readable message field consisting of 1 to 500 characters.
2. IF the Backend_Service encounters an unhandled internal error, THEN THE Auth_API SHALL respond with HTTP status 500 and an error body that excludes stack traces and internal implementation details.
3. IF the Backend_Service encounters an unhandled internal error while processing a state-changing request, THEN THE Auth_API SHALL preserve the prior persisted state so that no partial changes remain committed.
4. WHEN the Auth_API returns a validation error, THE Auth_API SHALL respond with HTTP status 400 and include a field-level list containing one entry for every field that failed validation, where each entry identifies the field name and a human-readable reason for the failure.

### Requirement 10: Secure Secret and Token Handling

**User Story:** As a backend operator, I want secrets and tokens handled securely, so that credentials are not exposed.

#### Acceptance Criteria

1. THE Token_Manager SHALL read the JWT signing key from an environment-provided configuration value rather than from any value embedded in source code.
2. IF the JWT signing key is absent from the environment-provided configuration or has a length of fewer than 32 characters, THEN THE Backend_Service SHALL abort startup, remain in a not-serving state, and emit a startup error indicating that the JWT signing key is missing or too short.
3. WHEN the Backend_Service persists a Refresh_Token to the Datastore, THE Backend_Service SHALL store only a one-way hashed representation of the Refresh_Token and SHALL NOT store the plaintext Refresh_Token value in the Datastore.
4. WHERE the Backend_Service is deployed to a non-local environment, WHEN the Backend_Service receives an inbound request that is not over HTTPS, THE Backend_Service SHALL reject the request without processing it and return a response indicating that HTTPS is required.
5. WHEN the Backend_Service writes request or response data to log output, THE Backend_Service SHALL exclude Password values, Access_Token values, and Refresh_Token values from that log output, substituting a fixed redaction placeholder in their place.

### Requirement 11: Authentication Event Logging

**User Story:** As a backend operator, I want authentication events recorded, so that a future analytics or admin dashboard effort can build on the data.

#### Acceptance Criteria

1. WHEN the Registration_Service creates a User_Account, THE Audit_Logger SHALL persist to the Datastore an Auth_Event of type registration containing the User_Account identifier and a UTC timestamp.
2. WHEN the Auth_Service successfully authenticates a login request, THE Audit_Logger SHALL persist to the Datastore an Auth_Event of type login-success containing the User_Account identifier, source IP address, and a UTC timestamp.
3. WHEN the Auth_Service rejects a login request, THE Audit_Logger SHALL persist to the Datastore an Auth_Event of type login-failure containing the submitted Email_Address, source IP address, and a UTC timestamp.
4. WHEN the Auth_Service revokes a Refresh_Token during logout, THE Audit_Logger SHALL persist to the Datastore an Auth_Event of type logout containing the User_Account identifier and a UTC timestamp.
5. IF the source IP address for a login-success or login-failure Auth_Event cannot be determined, THEN THE Audit_Logger SHALL record the Auth_Event with a fixed placeholder value in place of the source IP address.
6. WHEN the Audit_Logger records an Auth_Event, THE Audit_Logger SHALL exclude Password values and token values from the persisted Auth_Event record.
7. WHEN more than one Auth_Event trigger condition applies during a single operation, THE Audit_Logger SHALL record a separate Auth_Event for each applicable trigger condition.
8. IF a Datastore write for an Auth_Event fails, THEN THE Audit_Logger SHALL retry the write up to 3 times and, if all attempts fail, SHALL emit a non-blocking failure indication without interrupting the originating operation.
