/**
 * Example-based unit tests for login and refresh validation edge cases.
 *
 * Feature: user-registration-backend
 * Validates: Requirements 3.6 (login enforces presence + bounds only, NOT the
 * 8..128 password policy) and 4.5 (refresh requires a present, non-empty
 * refresh token).
 *
 * These are plain Jest example tests (no property-based testing), covering the
 * boundary and shape behaviour of {@link validateLogin} and
 * {@link validateRefresh}.
 */

import { EMAIL_MAX_LENGTH, validateLogin, validateRefresh } from './index';
import type { FieldError } from '../errors';

/** Collect the set of field names reported by an `ok: false` result. */
function failedFields(result: { ok: false; fields: FieldError[] }): string[] {
  return result.fields.map((f) => f.field);
}

describe('validateLogin (Req 3.6: presence + bounds only, no password policy)', () => {
  it('reports email when the email field is missing', () => {
    const result = validateLogin({ password: 'secret123' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(failedFields(result)).toContain('email');
  });

  it('reports email when the email is an empty string', () => {
    const result = validateLogin({ email: '', password: 'secret123' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(failedFields(result)).toContain('email');
  });

  it('reports email when the email is only whitespace', () => {
    const result = validateLogin({ email: '   ', password: 'secret123' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(failedFields(result)).toContain('email');
  });

  it('reports email when the email exceeds the maximum length', () => {
    // A syntactically plausible email whose length is > EMAIL_MAX_LENGTH.
    const longLocal = 'a'.repeat(EMAIL_MAX_LENGTH);
    const overLong = `${longLocal}@example.com`;
    expect(overLong.length).toBeGreaterThan(EMAIL_MAX_LENGTH);

    const result = validateLogin({ email: overLong, password: 'secret123' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(failedFields(result)).toContain('email');
  });

  it('reports password when the password field is missing', () => {
    const result = validateLogin({ email: 'user@example.com' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(failedFields(result)).toContain('password');
  });

  it('reports password when the password is an empty string', () => {
    const result = validateLogin({ email: 'user@example.com', password: '' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(failedFields(result)).toContain('password');
  });

  it('accepts a short password at login (8..128 policy NOT enforced)', () => {
    const result = validateLogin({ email: 'user@example.com', password: 'x' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    // Raw password is returned unchanged, even though it is shorter than the
    // registration minimum of 8 characters.
    expect(result.value.password).toBe('x');
  });

  it('normalizes a valid email (trim + lowercase) and preserves the raw password', () => {
    const result = validateLogin({
      email: '  User@Example.COM  ',
      password: '  RawPass  ',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.email).toBe('user@example.com');
    // The password must never be trimmed.
    expect(result.value.password).toBe('  RawPass  ');
  });

  it('reports both fields together when email and password are both missing', () => {
    const result = validateLogin({});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(failedFields(result)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
    // Each reported failure carries a field + reason shape.
    for (const entry of result.fields) {
      expect(typeof entry.field).toBe('string');
      expect(entry.field.length).toBeGreaterThan(0);
      expect(typeof entry.reason).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('validateRefresh (Req 4.5: present, non-empty refresh token)', () => {
  it('fails with a refreshToken field error when the token is missing', () => {
    const result = validateRefresh({});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(failedFields(result)).toEqual(['refreshToken']);
  });

  it('fails when the refresh token is an empty string', () => {
    const result = validateRefresh({ refreshToken: '' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(failedFields(result)).toContain('refreshToken');
  });

  it('fails when the refresh token is a number (non-string)', () => {
    const result = validateRefresh({ refreshToken: 12345 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(failedFields(result)).toContain('refreshToken');
  });

  it('fails when the refresh token is null (non-string)', () => {
    const result = validateRefresh({ refreshToken: null });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(failedFields(result)).toContain('refreshToken');
  });

  it('succeeds for a valid non-empty string and echoes the token unchanged', () => {
    const token = 'opaque-refresh-token-abc123';
    const result = validateRefresh({ refreshToken: token });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.refreshToken).toBe(token);
  });
});
