/**
 * Global configuration constants for the auth feature.
 * Edit BACKEND_URL to point at a different environment.
 * Local dev (Android emulator):  http://10.0.2.2:3001
 * Local dev (iOS simulator):     http://localhost:3001
 * VPS:                           http://<YOUR_VPS_IP>:3001
 */

/** Base URL for all Auth_API requests. Single location to change environments. */
export const BACKEND_URL = 'http://109.205.181.195:3001';

/** AsyncStorage key for the JWT access token. */
export const ACCESS_TOKEN_KEY = '@veeder/access_token';

/** AsyncStorage key for the refresh token. */
export const REFRESH_TOKEN_KEY = '@veeder/refresh_token';
