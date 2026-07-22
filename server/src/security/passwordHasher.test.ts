/**
 * Unit tests for the argon2id Password_Hasher (Task 6.2).
 *
 * Validates: Requirements 1.2 (passwords hashed with argon2 before persistence)
 * and 3.1 (verification of a plaintext password against a stored hash, with
 * malformed hashes treated as a non-match rather than throwing).
 *
 * argon2 hashing is intentionally CPU/memory-heavy, so these tests exercise a
 * small handful of representative cases (no large loops) and allow a generous
 * per-test timeout.
 */
import { hash, verify } from './passwordHasher';

// argon2id is memory-hard; give each case ample headroom on slower machines.
const HASH_TIMEOUT_MS = 30_000;

describe('passwordHasher', () => {
  it(
    'hash() returns an argon2id-encoded string that differs from the plaintext',
    async () => {
      const password = 'correct horse battery staple';

      const hashed = await hash(password);

      expect(typeof hashed).toBe('string');
      expect(hashed).not.toBe(password);
      expect(hashed.startsWith('$argon2id$')).toBe(true);
    },
    HASH_TIMEOUT_MS,
  );

  it(
    'verify() resolves true for the correct password',
    async () => {
      const password = 'S3cure-P@ssw0rd!';

      const hashed = await hash(password);

      await expect(verify(hashed, password)).resolves.toBe(true);
    },
    HASH_TIMEOUT_MS,
  );

  it(
    'verify() resolves false for an incorrect password',
    async () => {
      const password = 'S3cure-P@ssw0rd!';
      const wrongPassword = 'S3cure-P@ssw0rd?';

      const hashed = await hash(password);

      await expect(verify(hashed, wrongPassword)).resolves.toBe(false);
    },
    HASH_TIMEOUT_MS,
  );

  it(
    'verify() resolves false (does not throw) for a malformed hash string',
    async () => {
      await expect(verify('not-a-valid-hash', 'anything')).resolves.toBe(false);
      await expect(verify('', 'anything')).resolves.toBe(false);
    },
    HASH_TIMEOUT_MS,
  );

  it(
    'produces different hashes for the same password (random salt), both verifying true',
    async () => {
      const password = 'repeatable-password-123';

      const first = await hash(password);
      const second = await hash(password);

      // Distinct salts must yield distinct encoded hashes.
      expect(first).not.toBe(second);

      await expect(verify(first, password)).resolves.toBe(true);
      await expect(verify(second, password)).resolves.toBe(true);
    },
    HASH_TIMEOUT_MS,
  );
});
