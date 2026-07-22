# Implementation Plan: mobile-user-auth

## Notes

Dependency-ordered wave structure for the complete mobile-user-auth feature.
All new files go into `src/auth/` or `src/screens/`. Each task references the
requirement(s) it satisfies.

## Overview

Dependency-ordered wave structure for the complete mobile-user-auth feature.
All new files go into `src/auth/` or `src/screens/`. Each task references the
requirement(s) it satisfies.

---

## Tasks

### Wave 0 — Foundation (no dependencies)

- [ ] 1.1 Install required npm dependencies
  - Add `@react-native-async-storage/async-storage@2.1.2` and `axios@1.7.7` to `package.json` under `dependencies`
  - Run `npm install` to install both packages and update `package-lock.json`
  - Verify auto-linking works for `@react-native-async-storage/async-storage` on RN 0.86 (no manual native config needed)
  - _Validates: Req 3.5 (persistent storage), Req 4.x (HTTP client with interceptors)_

- [ ] 1.2 Create `src/auth/config.ts` — backend URL and AsyncStorage key constants
  - Export `BACKEND_URL` string constant set to `'http://<VPS_IP>:3001'`
  - Export `ACCESS_TOKEN_KEY = '@veeder/access_token'`
  - Export `REFRESH_TOKEN_KEY = '@veeder/refresh_token'`
  - This is the single location that must be edited to point the app at a different environment
  - _Validates: Req 7.1, Req 7.2_

- [ ] 1.3 Create `src/auth/types.ts` — shared TypeScript interfaces and result types
  - Define `TokenPair` interface: `{ accessToken: string; refreshToken: string }`
  - Define `UserProfile` interface: `{ id: string; email: string }`
  - Define `AuthState` union type: `'loading' | 'authenticated' | 'unauthenticated'`
  - Define `LoginResult` discriminated union: `{ ok: true } | { ok: false; reason: 'invalid_credentials' | 'rate_limited' | 'network_error' }`
  - Define `RegisterResult` discriminated union: `{ ok: true } | { ok: false; reason: 'already_exists' | 'invalid_input' | 'rate_limited' | 'network_error' }`
  - Define `AuthContextValue` interface with `user`, `authState`, `login`, `logout`, and `clearSession` members
  - _Validates: Req 1.4–1.7, Req 2.4–2.6, Req 3.x, Req 8.x_

### Wave 1 — Core Auth Modules (depends on Wave 0)

- [ ] 2.1 Create `src/auth/tokenStore.ts` — AsyncStorage persistence layer
  - Implement `save(pair: TokenPair): Promise<void>` using `AsyncStorage.multiSet([[ACCESS_TOKEN_KEY, pair.accessToken], [REFRESH_TOKEN_KEY, pair.refreshToken]])` for atomic write
  - Implement `load(): Promise<TokenPair | null>` using `AsyncStorage.multiGet([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY])`; return `null` if either value is missing or falsy; never throw — catch any storage error and return `null`
  - Implement `clear(): Promise<void>` using `AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY])` for atomic removal
  - Import key constants from `config.ts`
  - Export a singleton `tokenStore` object implementing the `TokenStore` interface
  - _Validates: Req 3.1, Req 3.4, Req 3.5, Req 6.3_

- [ ] 2.2 Create `src/auth/refreshCoordinator.ts` — single-flight refresh coordinator
  - Maintain a module-level `inFlight: Promise<TokenPair | null> | null` variable (initially `null`)
  - Export `createRefreshCoordinator(deps: { performRefresh(): Promise<TokenPair>; onSessionEnded(): void })` factory function
  - Implement `ensureRefresh(): Promise<TokenPair | null>`: if `inFlight` is not null, return the existing promise; otherwise create a new promise that calls `deps.performRefresh()`, saves the result, clears `inFlight` on settlement, and calls `deps.onSessionEnded()` + returns `null` on any rejection
  - Clear `inFlight` in a `finally` block so subsequent 401s trigger a fresh cycle
  - Export a placeholder singleton that is wired up by `AuthContext` at runtime (to allow `apiClient` to import it without a circular dependency)
  - _Validates: Req 4.6_

- [ ] 2.3 Create `src/auth/authService.ts` — API wrapper functions
  - Import `apiClient` (will be created in Wave 2) and types from `types.ts`
  - Implement `register(email, password): Promise<RegisterResult>`: POST to `/register`; map `201` → `{ ok: true }`, `409` → `{ ok: false, reason: 'already_exists' }`, `400` → `{ ok: false, reason: 'invalid_input' }`, `429` → `{ ok: false, reason: 'rate_limited' }`, network error → `{ ok: false, reason: 'network_error' }`; never throw
  - Implement `login(email, password): Promise<LoginResult>`: POST to `/login`; map `200` with `{ accessToken, refreshToken }` → call `tokenStore.save(pair)` then return `{ ok: true }`; map `401` → `invalid_credentials`, `429` → `rate_limited`, network error → `network_error`; never throw; never call `tokenStore.save` on any non-200 path
  - Implement `logout(refreshToken: string): Promise<void>`: POST to `/logout` with `{ refreshToken }` in body; swallow all errors (network failures are intentionally ignored)
  - Implement `getMe(): Promise<UserProfile | null>`: GET `/me`; return `UserProfile` on `200`; return `null` on `401` (interceptor will handle session end); rethrow other errors for caller to handle
  - Export `authService` singleton
  - _Validates: Req 1.2, Req 1.4–1.7, Req 2.2–2.6, Req 5.1, Req 6.1_

### Wave 2 — HTTP Client and React Context (depends on Wave 1)

- [ ] 3.1 Create `src/auth/apiClient.ts` — axios instance with auth interceptors
  - Create axios instance: `axios.create({ baseURL: BACKEND_URL })` using constant from `config.ts`
  - Add request interceptor: read `accessToken` from the in-memory session ref (injected via `setSessionRef`); if present, set `Authorization: Bearer <token>` header; never read from URL or query string
  - Add response interceptor: on `401`, check if the request URL ends with `/login`, `/register`, or `/refresh`, or if `config._retried` is `true`; if so, reject immediately; otherwise set `config._retried = true`, call `refreshCoordinator.ensureRefresh()`, update the Authorization header with the new token and retry; if `ensureRefresh` returns `null`, reject without retrying
  - Export `setSessionRef(ref: React.MutableRefObject<TokenPair | null>): void` so `AuthContext` can inject the ref after mount
  - Export `apiClient` singleton
  - _Validates: Req 4.1, Req 4.2, Req 4.3, Req 4.4, Req 4.5, Req 4.7, Req 7.2_

- [ ] 3.2 Create `src/auth/AuthContext.tsx` — React context, provider, and hook
  - Create `AuthContext` with `React.createContext<AuthContextValue>` (throw if used outside provider)
  - Implement `AuthProvider` component:
    - Initialise `authState` via `useState<AuthState>('loading')`
    - Keep in-memory session in `useRef<TokenPair | null>(null)`; inject ref into `apiClient` via `setSessionRef`
    - Bootstrap in `useEffect` (runs once on mount): call `tokenStore.load()`; if tokens found, set session ref and set `authState = 'authenticated'`; if not, set `authState = 'unauthenticated'`
    - Wire `refreshCoordinator` with `performRefresh` (bare `axios.post('/refresh', ...)` — not `apiClient`) and `onSessionEnded` → `clearSession()`
    - Implement `login(email, password)`: call `authService.login()`; on `{ ok: true }` update session ref and set `authState = 'authenticated'`; return the `LoginResult` to the caller
    - Implement `logout()`: call `authService.logout(session.refreshToken)` (best-effort); in `finally` call `clearSession()`
    - Implement `clearSession()`: null the session ref, call `tokenStore.clear()`, set `authState = 'unauthenticated'`
  - Export `useAuth(): AuthContextValue` hook (throws if context is null)
  - _Validates: Req 2.3, Req 3.2, Req 3.3, Req 3.4, Req 6.2, Req 6.3, Req 8.2, Req 8.3, Req 8.4_

- [ ] 3.3 Create `src/auth/AuthNavigator.tsx` — conditional screen renderer
  - Consume `authState` and `useAuth()` from `AuthContext`
  - Maintain local `screen: 'login' | 'register'` state (default `'login'`)
  - Render exactly one branch at a time using `if / else if / else`:
    - `authState === 'loading'` → `<ActivityIndicator />` centered in a full-screen `View`
    - `authState === 'unauthenticated'` and `screen === 'login'` → `<LoginScreen onGoToRegister={() => setScreen('register')} />`
    - `authState === 'unauthenticated'` and `screen === 'register'` → `<RegisterScreen onGoToLogin={() => setScreen('login')} />`
    - `authState === 'authenticated'` → `<HomeScreen />`
  - Never render `HomeScreen` and `LoginScreen`/`RegisterScreen` simultaneously
  - _Validates: Req 8.1, Req 8.2, Req 8.3, Req 8.4_

### Wave 3 — Screens (depends on Wave 2)

- [ ] 4.1 Create `src/screens/RegisterScreen.tsx` — registration form
  - Props: `onGoToLogin: () => void`
  - Render: email `TextInput` (keyboardType `email-address`, autoCapitalize `none`), password `TextInput` (secureTextEntry), submit `TouchableOpacity`/`Button`, and a "Go to Login" link that calls `onGoToLogin`
  - On submit: validate both fields are non-empty (show inline "Email is required." / "Password is required." without making a network request); disable submit button while request is in progress; call `authService.register(email, password)`
  - Map result reasons to user-facing messages:
    - `already_exists` → "An account with this email already exists."
    - `invalid_input` → "Invalid email or password format."
    - `rate_limited` → "Too many attempts — please try again later."
    - `network_error` → "Could not connect. Check your connection and try again."
  - On `{ ok: true }`: call `onGoToLogin()` to transition to LoginScreen (no tokens stored)
  - Re-enable submit button after the request completes (success or error)
  - _Validates: Req 1.1, Req 1.2, Req 1.3, Req 1.4, Req 1.5, Req 1.6, Req 1.7, Req 1.8, Req 1.9_

- [ ] 4.2 Create `src/screens/LoginScreen.tsx` — login form
  - Props: `onGoToRegister: () => void`
  - Render: email `TextInput` (keyboardType `email-address`, autoCapitalize `none`), password `TextInput` (secureTextEntry), submit `TouchableOpacity`/`Button`, and a "Go to Register" link that calls `onGoToRegister`
  - On submit: validate both fields are non-empty (show inline field errors without a network request); disable submit button while request is in progress; call `AuthContext.login(email, password)`
  - Map result reasons to user-facing messages:
    - `invalid_credentials` → "Incorrect email or password."
    - `rate_limited` → "Too many login attempts — please try again later."
    - `network_error` → "Could not connect. Check your connection and try again."
  - On `{ ok: true }`: `AuthContext` transitions `authState = 'authenticated'`; `AuthNavigator` re-renders to `HomeScreen` automatically
  - Re-enable submit button after the request completes (success or error)
  - _Validates: Req 2.1, Req 2.2, Req 2.3, Req 2.4, Req 2.5, Req 2.6, Req 2.7, Req 2.8_

- [ ] 4.3 Create `src/screens/HomeScreen.tsx` — authenticated home screen
  - Consume `useAuth()` to access `user` and `logout`
  - On mount (`useEffect`): call `authService.getMe()`; on success set local `profile` state and display `profile.email`; on network error (non-401) show an inline error banner "Could not load profile." with a "Retry" button; on `null` return (401 handled by interceptor), do nothing (navigation will happen automatically via `clearSession`)
  - Render: display the authenticated user's email address, mount `<MediaShareScreen />` to preserve existing functionality, and a sign-out `TouchableOpacity`/`Button`
  - Sign-out button calls `AuthContext.logout()`; `AuthNavigator` transitions to `LoginScreen` automatically after `clearSession()` runs
  - _Validates: Req 5.1, Req 5.2, Req 5.3, Req 5.4, Req 5.5, Req 6.1, Req 6.2, Req 6.3_

### Wave 4 — Entry Point Integration (depends on Wave 3)

- [ ] 5.1 Update `App.tsx` — wrap app in auth provider and navigator
  - Import `AuthProvider` from `src/auth/AuthContext`
  - Import `AuthNavigator` from `src/auth/AuthNavigator`
  - Replace the existing `<MediaShareScreen />` root render with `<AuthProvider><AuthNavigator /></AuthProvider>`
  - Remove the direct import of `MediaShareScreen` from `App.tsx` (it is now rendered inside `HomeScreen`)
  - Ensure the `SafeAreaView` / root style wrapper is preserved around the new tree
  - _Validates: Req 8.1, Req 8.2, Req 8.3, Req 8.4, Req 5.3_

### Checkpoint

- [ ] 6.1 Checkpoint — TypeScript and runtime verification
  - Run `npx tsc --noEmit` from the project root; resolve all type errors before proceeding
  - Build and run on Android emulator or device; verify:
    - Cold start shows loading spinner then transitions to `LoginScreen` (no stored tokens)
    - Registration with a new email navigates to `LoginScreen`
    - Login with valid credentials navigates to `HomeScreen` and displays the user's email
    - Killing and restarting the app goes directly to `HomeScreen` (tokens persisted)
    - Sign-out clears storage and returns to `LoginScreen`
    - Confirm `MediaShareScreen` is accessible from `HomeScreen`
  - _Validates: All requirements_

### Optional Property-Based Tests

- [ ] 7.1* Write property test for `tokenStore` — never partial pair
  - Use a property-based test library (e.g. fast-check) to assert: for any `TokenPair` input, after `tokenStore.save(pair)`, `tokenStore.load()` returns a pair with both tokens present, or returns `null` — never a partial pair with only one token
  - Test that after `tokenStore.clear()`, `tokenStore.load()` always returns `null`
  - _Validates: Req 3.1, Req 3.4 (Property 1)_

- [ ] 7.2* Write property test for `refreshCoordinator` — single-flight guarantee
  - Simulate N concurrent calls to `ensureRefresh()` (N ∈ [2, 20]) and assert that the injected `performRefresh` mock is called exactly once
  - Assert all N callers resolve with the same `TokenPair` value
  - _Validates: Req 4.6 (Property 3)_

- [ ] 7.3* Write property test for `authService.login` — network error never stores tokens
  - For any `(email, password)` pair, when `POST /login` rejects with a network error, assert that `tokenStore.save` is never called and `tokenStore.load()` returns the same value it held before the call
  - _Validates: Req 2.6 (Property 10)_

- [ ] 7.4* Write property test for logout — always clears tokens
  - For any server response to `POST /logout` (200, 500, network timeout, DNS failure), assert that after `authService.logout()` completes, `tokenStore.load()` returns `null`
  - _Validates: Req 6.2, Req 6.3 (Property 2)_

- [ ] 7.5* Write property test for `AuthNavigator` — never shows home and login simultaneously
  - For any sequence of `authState` transitions (`loading → authenticated`, `loading → unauthenticated`, `authenticated → unauthenticated`), assert the rendered React tree contains at most one of `HomeScreen`, `LoginScreen`, `RegisterScreen` at any point
  - _Validates: Req 8.1 (Property 8)_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 4, "tasks": ["5.1"] },
    { "id": 5, "tasks": ["6.1"] }
  ]
}
```
