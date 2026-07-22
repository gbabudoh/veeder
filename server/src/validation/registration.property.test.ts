// Feature: user-registration-backend, Property 4: Validation reports exactly the fields that failed
/**
 * Property-based test for field-accurate registration validation errors.
 *
 * Design reference: `design.md` -> "Property 4: Validation reports exactly the
 * fields that failed". This test drives {@link validateRegistration} with
 * registration bodies whose `email` and `password` are, independently, either
 * VALID or INVALID (drawn from dedicated arbitraries). From the generators we
 * know the exact set of fields that should fail, and we assert that:
 *
 *  - when both fields are valid, the validator returns `ok: true` with the
 *    normalized (trimmed + lowercased) email and the raw password; and
 *  - otherwise it returns `ok: false` whose set of reported `field` names is
 *    EXACTLY the set of fields that violated a rule (no missing, no extra),
 *    each with a non-empty human-readable reason.
 *
 * The global fast-check config (see `src/test/setup.ts`) runs a minimum of 100
 * iterations per property.
 *
 * Validates: Requirements 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 9.4
 */
import fc from 'fast-check';
import {
  validateRegistration,
  EMAIL_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from './index';

/** A generated field value tagged with whether it should be accepted. */
interface FieldCase {
  /** The value placed on the request body (may be a non-string / missing). */
  raw: unknown;
  /** Whether the validator should accept this value. */
  valid: boolean;
  /** For a valid email, the expected normalized (trim + lowercase) form. */
  normalized?: string;
}

// Character set for identifier-like, non-whitespace tokens.
const TOKEN_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

const token = (minLength: number, maxLength: number) =>
  fc.stringOf(fc.constantFrom(...TOKEN_CHARS), { minLength, maxLength });

// --- Email arbitraries -----------------------------------------------------

// A well-formed `local@domain.tld` address wrapped with optional surrounding
// whitespace and arbitrary letter case, so normalization (trim + lowercase) is
// exercised. All variants are valid because format checks run on the trimmed
// value (Req 2.6).
const validEmail: fc.Arbitrary<FieldCase> = fc
  .record({
    local: token(1, 12),
    domain: token(1, 12),
    tld: token(1, 8),
    lead: fc.constantFrom('', ' ', '  ', '\t'),
    trail: fc.constantFrom('', ' ', '\n', '  '),
  })
  .map(({ local, domain, tld, lead, trail }) => {
    const raw = `${lead}${local}@${domain}.${tld}${trail}`;
    return { raw, valid: true, normalized: raw.trim().toLowerCase() };
  });

// Emails that violate at least one rule: missing, empty, whitespace-only,
// missing "@", a domain with no ".", or longer than 254 characters (Req 2.1,
// 2.2, 2.4).
const invalidEmail: fc.Arbitrary<FieldCase> = fc
  .oneof(
    fc.constant(undefined), // missing field (Req 2.4)
    fc.constant(''), // empty (Req 2.4)
    fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 6 }), // whitespace-only (Req 2.4)
    token(1, 20), // no "@" (Req 2.1)
    fc.tuple(token(1, 12), token(1, 12)).map(([l, d]) => `${l}@${d}`), // no "." in domain (Req 2.1)
    token(EMAIL_MAX_LENGTH + 1, EMAIL_MAX_LENGTH + 20).map((s) => `${s}@domain.tld`), // > 254 (Req 2.2)
  )
  .map((raw) => ({ raw, valid: false }));

// --- Password arbitraries --------------------------------------------------

// Non-whitespace passwords whose length is within the inclusive 8..128 bound.
const validPassword: fc.Arbitrary<FieldCase> = token(
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
).map((raw) => ({ raw, valid: true }));

// Passwords that violate a rule: missing, too short (0..7), too long (>128), or
// whitespace-only (Req 2.3, 2.4).
const invalidPassword: fc.Arbitrary<FieldCase> = fc
  .oneof(
    fc.constant(undefined), // missing field (Req 2.4)
    token(0, PASSWORD_MIN_LENGTH - 1), // too short, includes empty (Req 2.3, 2.4)
    token(PASSWORD_MAX_LENGTH + 1, PASSWORD_MAX_LENGTH + 40), // too long (Req 2.3)
    fc.stringOf(fc.constantFrom(' ', '\t'), { minLength: 1, maxLength: 20 }), // whitespace-only (Req 2.4)
  )
  .map((raw) => ({ raw, valid: false }));

const emailCase = fc.oneof(validEmail, invalidEmail);
const passwordCase = fc.oneof(validPassword, invalidPassword);

describe('validateRegistration - Property 4: reports exactly the failing fields', () => {
  it('returns exactly the set of fields that violated a rule (Req 1.7, 2.1-2.5, 9.4)', () => {
    fc.assert(
      fc.property(emailCase, passwordCase, (email, password) => {
        const body = { email: email.raw, password: password.raw };
        const result = validateRegistration(body);

        const expectedFailing: string[] = [];
        if (!email.valid) {
          expectedFailing.push('email');
        }
        if (!password.valid) {
          expectedFailing.push('password');
        }

        if (expectedFailing.length === 0) {
          // Both valid: normalized email + raw password are returned.
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.email).toBe(email.normalized);
            expect(result.value.password).toBe(password.raw);
          }
          return;
        }

        // At least one field is invalid: the reported field set must match
        // the expected failing set exactly (no missing, no extra).
        expect(result.ok).toBe(false);
        if (!result.ok) {
          const actualFields = result.fields.map((f) => f.field).sort();
          expect(actualFields).toEqual([...expectedFailing].sort());

          // No duplicate entries per field.
          expect(new Set(actualFields).size).toBe(actualFields.length);

          // Every entry carries a non-empty human-readable reason (Req 9.4).
          for (const fieldError of result.fields) {
            expect(typeof fieldError.reason).toBe('string');
            expect(fieldError.reason.length).toBeGreaterThan(0);
          }
        }
      }),
    );
  });
});
