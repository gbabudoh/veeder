/**
 * Token_Store — persists the JWT access + refresh token pair to AsyncStorage.
 *
 * Uses multiSet / multiGet / multiRemove for atomic reads and writes so the
 * store never lands in a state where only one token is present.
 * Never throws — all errors are caught and return null / void.
 *
 * Requirements: 3.1, 3.4, 3.5, 6.3
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY } from './config';
import type { TokenPair } from './types';

/**
 * Atomically persist both tokens to AsyncStorage.
 * If the write fails, neither token is stored.
 */
export async function save(pair: TokenPair): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [ACCESS_TOKEN_KEY, pair.accessToken],
      [REFRESH_TOKEN_KEY, pair.refreshToken],
    ]);
  } catch {
    // Storage write failed — caller continues; session is still in memory.
  }
}

/**
 * Read the stored token pair.
 * Returns null if either token is missing, falsy, or any error occurs.
 */
export async function load(): Promise<TokenPair | null> {
  try {
    const pairs = await AsyncStorage.multiGet([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY]);
    const accessToken = pairs[0][1];
    const refreshToken = pairs[1][1];
    if (!accessToken || !refreshToken) {
      return null;
    }
    return { accessToken, refreshToken };
  } catch {
    return null;
  }
}

/**
 * Atomically remove both tokens from AsyncStorage.
 */
export async function clear(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY]);
  } catch {
    // Storage clear failed — in-memory session is still cleared by caller.
  }
}

export const tokenStore = { save, load, clear };
