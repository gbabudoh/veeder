# Requirements Document

## Introduction

The mobile-user-auth feature connects the veeder React Native mobile app (0.86 + TypeScript) to the existing Node/Express backend authentication API. It introduces a complete authentication flow: registration, login, persistent session storage, transparent token refresh, an authenticated home screen, and logout. After login the user lands on a home screen that displays their email and provides access to the existing Media Share feature. The feature adds a lightweight navigation layer to the app to switch between the unauthenticated screens (Register/Login) and the authenticated screen (Home).

## Glossary

- **App**: The veeder React Native mobile application.
- **Auth_API**: The remote Node/Express backend exposing `POST /register`, `POST /login`, `POST /refresh`, `POST /logout`, and `GET /me`.
- **Register_Screen**: The UI screen that collects an email address and password and calls `POST /register`.
- **Login_Screen**: The UI screen that collects an email address and password and calls `POST /login`.
- **Home_Screen**: The authenticated screen shown after a successful login; displays the user's email and a sign-out button, and integrates the Media Share feature.
- **Auth_Navigator**: The in-app component that controls which screen (Register_Screen, Login_Screen, or Home_Screen) is currently visible, based on authentication state.
- **Token_Store**: The secure on-device storage layer that persists the access token and refresh token across app restarts.
- **API_Client**: The HTTP client used by the App to communicate with the Auth_API; owns bearer-token attachment and 401 refresh-and-retry logic.
- **Refresh_Coordinator**: The component inside the API_Client that ensures at most one in-flight token refresh occurs at a time, with all concurrent callers sharing its result.
- **Session**: The in-memory runtime state that holds the current access token and refresh token while the App is running.
- **Access_Token**: A short-lived JWT (15-minute TTL) used to authenticate API requests via the `Authorization: Bearer` header.
- **Refresh_Token**: A long-lived token (30-day TTL) used to obtain a new Access_Token via `POST /refresh`.
- **Backend_URL**: The configurable base URL for all Auth_API requests; read from a single configuration constant at build time.

---

## Requirements

### Requirement 1: User Registration

**User Story:** As a new user, I want to create an account with my email and password, so that I can access the app.

#### Acceptance Criteria

1. THE Register_Screen SHALL display an email input field, a password input field, and a submit button.
2. WHEN the user submits the registration form with a non-empty email and a non-empty password, THE App SHALL call `POST /register` on the Auth_API with the provided credentials.
3. WHEN the Auth_API returns a `201` response to `POST /register` and the response has been fully received, THE Auth_Navigator SHALL transition to the Login_Screen.
4. IF the Auth_API returns a `409` response to `POST /register`, THEN THE Register_Screen SHALL display a message indicating the email address is already registered.
5. IF the Auth_API returns a `400` response to `POST /register`, THEN THE Register_Screen SHALL display a message indicating the submitted data is invalid.
6. IF the Auth_API returns a `429` response to `POST /register`, THEN THE Register_Screen SHALL display a message indicating too many attempts and advise the user to try again later.
7. IF the network request to `POST /register` fails due to a connectivity error, THEN THE Register_Screen SHALL display a message indicating the request could not be completed.
8. WHILE a registration request is in progress, THE Register_Screen SHALL disable the submit button to prevent duplicate submissions.
9. THE Register_Screen SHALL provide a navigation control that, when activated, transitions the Auth_Navigator to the Login_Screen.

---

### Requirement 2: User Login

**User Story:** As a registered user, I want to log in with my email and password, so that I can access my account.

#### Acceptance Criteria

1. THE Login_Screen SHALL display an email input field, a password input field, and a submit button.
2. WHEN the user submits the login form with a non-empty email and a non-empty password, THE App SHALL call `POST /login` on the Auth_API with the provided credentials.
3. WHEN the Auth_API returns a `200` response to `POST /login` with an `accessToken` and a `refreshToken`, THE App SHALL store both tokens in the Token_Store and transition the Auth_Navigator to the Home_Screen.
4. IF the Auth_API returns a `401` response to `POST /login`, THEN THE Login_Screen SHALL display a message indicating the credentials are incorrect.
5. IF the Auth_API returns a `429` response to `POST /login`, THEN THE Login_Screen SHALL display a message indicating too many attempts and advise the user to try again later.
6. IF the network request to `POST /login` fails due to a connectivity error, THEN THE Login_Screen SHALL display a message indicating the request could not be completed.
7. WHILE a login request is in progress, THE Login_Screen SHALL disable the submit button to prevent duplicate submissions.
8. THE Login_Screen SHALL provide a navigation control that, when activated, transitions the Auth_Navigator to the Register_Screen.

---

### Requirement 3: Persistent Session

**User Story:** As a returning user, I want my login session to survive app restarts, so that I do not need to log in every time I open the app.

#### Acceptance Criteria

1. WHEN the App stores a token pair after a successful login, THE Token_Store SHALL persist both the access token and the refresh token to secure device storage.
2. WHEN the App starts and the Token_Store contains a previously persisted token pair, THE Auth_Navigator SHALL transition directly to the Home_Screen without displaying the Login_Screen.
3. WHEN the App starts and the Token_Store does not contain a persisted token pair, THE Auth_Navigator SHALL display the Login_Screen.
4. WHEN the Session is cleared (due to logout or session expiry), THE Token_Store SHALL remove the persisted token pair from device storage.
5. THE Token_Store SHALL store tokens using a storage mechanism that persists across app process restarts.

---

### Requirement 4: Auto Token Refresh

**User Story:** As a logged-in user, I want my session to be automatically renewed when it expires, so that I am not interrupted by unexpected logouts during normal use.

#### Acceptance Criteria

1. WHEN the Auth_API returns a `401` response to any request other than `POST /login`, `POST /register`, or `POST /refresh`, THE API_Client SHALL call `POST /refresh` on the Auth_API with the current refresh token.
2. WHEN `POST /refresh` returns a new token pair, THE API_Client SHALL update the Token_Store with the new tokens and retry the original failed request exactly once with the new access token.
3. IF the retried request returns a `401` response after the token has been refreshed, THEN THE API_Client SHALL clear the Session, remove tokens from the Token_Store, and transition the Auth_Navigator to the Login_Screen.
4. IF `POST /refresh` returns a `401` response, THEN THE API_Client SHALL clear the Session, remove tokens from the Token_Store, and transition the Auth_Navigator to the Login_Screen.
5. IF the network request to `POST /refresh` fails due to a connectivity error, THEN THE API_Client SHALL clear the Session, remove tokens from the Token_Store, and transition the Auth_Navigator to the Login_Screen.
6. WHILE a token refresh is in progress, THE Refresh_Coordinator SHALL ensure that concurrent API requests awaiting a new access token share the single in-flight refresh result rather than each initiating a separate refresh call.
7. THE API_Client SHALL attach the Access_Token to every authenticated request as an `Authorization: Bearer <token>` header; if a token is also present in the URL or query string of a request, THE API_Client SHALL use the header value and ignore the URL token.

---

### Requirement 5: Authenticated Home Screen

**User Story:** As a logged-in user, I want a home screen that shows my account details and gives me access to the Media Share feature, so that I can use the app after logging in.

#### Acceptance Criteria

1. WHEN the Auth_Navigator transitions to the Home_Screen, THE App SHALL call `GET /me` on the Auth_API to retrieve the authenticated user's profile.
2. WHEN `GET /me` returns a `200` response containing `id` and `email`, THE Home_Screen SHALL display the user's email address.
3. THE Home_Screen SHALL display the Media Share feature, providing the same functionality available in the current standalone app.
4. THE Home_Screen SHALL display a sign-out button.
5. IF `GET /me` fails and the Session has been cleared by the API_Client, THEN THE Auth_Navigator SHALL transition to the Login_Screen.

---

### Requirement 6: Logout

**User Story:** As a logged-in user, I want to sign out of my account, so that my session is terminated and my credentials are removed from the device.

#### Acceptance Criteria

1. WHEN the user activates the sign-out button on the Home_Screen, THE App SHALL call `POST /logout` on the Auth_API with the current refresh token.
2. WHEN `POST /logout` returns any response or fails due to a connectivity error, THE App SHALL clear the Session, remove all tokens from the Token_Store, and transition the Auth_Navigator to the Login_Screen.
3. AFTER logout completes, THE Token_Store SHALL contain no access token and no refresh token.

---

### Requirement 7: Backend URL Configuration

**User Story:** As a developer, I want the backend URL to be configurable from a single location, so that I can point the app at different environments without changing multiple files.

#### Acceptance Criteria

1. THE API_Client SHALL read the Backend_URL from a single configuration constant that can be updated without modifying business logic files.
2. THE API_Client SHALL use the Backend_URL as the base for all requests to the Auth_API.

---

### Requirement 8: In-App Navigation

**User Story:** As a user, I want the app to show me the correct screen based on my authentication state, so that I am not able to access protected content without being logged in.

#### Acceptance Criteria

1. THE Auth_Navigator SHALL render exactly one active screen at a time: either an unauthenticated screen (Register_Screen or Login_Screen) or the Home_Screen, and SHALL NOT render both the Home_Screen and the Login_Screen simultaneously.
2. WHEN the Session is valid, THE Auth_Navigator SHALL render the Home_Screen.
3. WHEN the Session is absent or has been cleared, THE Auth_Navigator SHALL render the Login_Screen.
4. THE Auth_Navigator SHALL display the Login_Screen until it has finished reading the Token_Store and confirmed a valid Session is present; WHILE the Token_Store read is pending, THE Auth_Navigator SHALL display a loading indicator.
