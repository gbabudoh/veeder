/**
 * Auth_Service — thin wrappers over apiClient for every auth endpoint.
 * Never throws. All failures are encoded in the result type.
 *
 * Requirements: 1.2, 1.4-1.7, 2.2-2.6, 5.1, 6.1
 */

import axios from 'axios';
import { getApiClient } from './apiClient';
import type { LoginResult, RegisterResult, TokenPair, UserProfile } from './types';
import { tokenStore } from './tokenStore';

function isNetworkError(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response;
}

function statusOf(error: unknown): number | null {
  if (axios.isAxiosError(error) && error.response) {
    return error.response.status;
  }
  return null;
}

/**
 * Register a new account.
 * 201 → ok. 409 → already_exists. 400 → invalid_input. 429 → rate_limited.
 * Network error → network_error. Never throws.
 */
export async function register(
  email: string,
  password: string,
): Promise<RegisterResult> {
  try {
    await getApiClient().post('/register', { email, password });
    return { ok: true };
  } catch (error) {
    const status = statusOf(error);
    if (status === 409) return { ok: false, reason: 'already_exists' };
    if (status === 400) return { ok: false, reason: 'invalid_input' };
    if (status === 429) return { ok: false, reason: 'rate_limited' };
    return { ok: false, reason: 'network_error' };
  }
}

/**
 * Authenticate with email + password.
 * On 200: saves tokens to tokenStore then returns ok.
 * 401 → invalid_credentials. 429 → rate_limited. Network → network_error.
 * Never calls tokenStore.save on any non-200 path. Never throws.
 */
export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  try {
    const response = await getApiClient().post<TokenPair>('/login', { email, password });
    await tokenStore.save(response.data);
    return { ok: true };
  } catch (error) {
    if (isNetworkError(error)) return { ok: false, reason: 'network_error' };
    const status = statusOf(error);
    if (status === 401) return { ok: false, reason: 'invalid_credentials' };
    if (status === 429) return { ok: false, reason: 'rate_limited' };
    return { ok: false, reason: 'network_error' };
  }
}

/**
 * Invalidate the given refresh token server-side.
 * Best-effort — swallows all errors. Network failures are intentionally ignored.
 */
export async function logout(refreshToken: string): Promise<void> {
  try {
    await getApiClient().post('/logout', { refreshToken });
  } catch {
    // Intentionally swallowed — local session is cleared unconditionally by caller.
  }
}

/**
 * Fetch the authenticated user's profile.
 * Returns UserProfile on 200. Returns null on 401 (interceptor handles session end).
 * Throws on other errors (caller decides how to surface them).
 */
export async function getMe(): Promise<UserProfile | null> {
  try {
    const response = await getApiClient().get<UserProfile>('/me');
    return response.data;
  } catch (error) {
    const status = statusOf(error);
    if (status === 401) return null;
    throw error;
  }
}

export const authService = { register, login, logout, getMe };
