import * as argon2 from 'argon2';

/**
 * Password_Hasher component.
 *
 * Hashes and verifies user passwords using argon2id, the current OWASP
 * first-choice password hashing algorithm (Req 1.2, 3.1).
 *
 * No plaintext password (or hash) is ever logged by this module.
 */

/**
 * Hash a plaintext password using argon2id.
 *
 * @param plainPassword The user-supplied plaintext password.
 * @returns A self-describing argon2id hash string safe to persist (Req 1.2).
 */
export async function hash(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, { type: argon2.argon2id });
}

/**
 * Verify a plaintext password against a stored argon2 hash.
 *
 * Returns `false` (rather than throwing) when the stored hash is malformed or
 * otherwise unparseable, so callers can treat any non-match uniformly (Req 3.1).
 *
 * @param hashString The stored argon2 hash to verify against.
 * @param plainPassword The user-supplied plaintext password to check.
 * @returns `true` when the password matches the hash, otherwise `false`.
 */
export async function verify(hashString: string, plainPassword: string): Promise<boolean> {
  try {
    return await argon2.verify(hashString, plainPassword);
  } catch {
    // argon2.verify throws on malformed/invalid hash strings; treat as a non-match.
    return false;
  }
}

export const passwordHasher = { hash, verify };
