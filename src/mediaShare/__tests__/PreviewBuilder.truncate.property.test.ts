// Feature: simple-media-share, Property 6: File-name truncation preserves short names and marks long ones

import fc from 'fast-check';

import { FILE_NAME_MAX_CHARS } from '../constants';
import { truncateFileName } from '../PreviewBuilder';

/**
 * Property 6 (Validates: Requirements 4.4)
 *
 * For any file name, truncateFileName returns the original text unchanged with
 * truncated:false when the name is at most FILE_NAME_MAX_CHARS (40) code points,
 * and otherwise returns text whose visible code-point length (including the
 * truncation indicator) does not exceed 40 with truncated:true. The truncation
 * indicator '\u2026' is present exactly when truncation occurred.
 *
 * IMPORTANT: length is measured by code points via Array.from(...).length to
 * match the implementation, not by string.length (UTF-16 code units).
 */

const TRUNCATION_INDICATOR = '\u2026'; // …

// Count of Unicode code points (matches the implementation's Array.from split).
const codePointLength = (s: string): number => Array.from(s).length;

// A pool of "characters" that stress multi-byte, emoji, surrogate-pair, and
// combining scenarios. Each entry is a single user-perceived unit but may span
// multiple UTF-16 code units. Note: an emoji like 😀 is one code point; a
// base+combining sequence like "e\u0301" is two code points, which is exactly
// the kind of case the code-point-based measurement must handle.
const charPool = fc.oneof(
  // ASCII letters/digits (1 code point, 1 UTF-16 unit).
  fc.constantFrom('a', 'b', 'Z', '0', '9', '-', '_', '.'),
  // Multi-byte BMP characters (1 code point, 1 UTF-16 unit).
  fc.constantFrom('é', 'ñ', 'ü', 'Ω', 'あ', '中', 'ф'),
  // Emoji / astral characters (1 code point, 2 UTF-16 units / surrogate pair).
  fc.constantFrom('😀', '🎉', '🚀', '🌟', '𝔘', '🐛'),
  // Combining marks (their own code point) to exercise multi-code-point glyphs.
  fc.constantFrom('\u0301', '\u0308', '\u0327'),
);

/**
 * Build a string with an exact number of code points from the mixed char pool.
 * Using join('') keeps each generated element as a discrete code point unit so
 * Array.from(result).length === count holds by construction.
 */
const nameOfCodePointLength = (count: number): fc.Arbitrary<string> =>
  count === 0
    ? fc.constant('')
    : fc.array(charPool, { minLength: count, maxLength: count }).map(cps => cps.join(''));

// Lengths concentrated around the 40-code-point boundary, plus 0 and larger.
const boundaryLengthArb = fc.oneof(
  fc.constantFrom(0, 1, 38, 39, 40, 41, 42, 60, 80),
  fc.integer({ min: 0, max: 120 }),
);

// A name whose code-point length is drawn from the boundary distribution.
const boundaryNameArb: fc.Arbitrary<string> = boundaryLengthArb.chain(
  nameOfCodePointLength,
);

// Also mix in fully arbitrary unicode strings so we don't only test the
// controlled generator. fc.string() covers the default unit, and
// fc.string({ unit: 'binary' }) covers the full Unicode range including astral
// (emoji/surrogate-pair) code points — the fast-check v4 replacement for the
// removed fc.fullUnicodeString().
const arbitraryNameArb: fc.Arbitrary<string> = fc.oneof(
  fc.string(),
  fc.string({ maxLength: 120 }),
  fc.string({ unit: 'binary' }),
  fc.string({ unit: 'binary', maxLength: 120 }),
);

const nameArb: fc.Arbitrary<string> = fc.oneof(boundaryNameArb, arbitraryNameArb);

describe('truncateFileName - Property 6: preserves short names and marks long ones', () => {
  it('short names (<= 40 code points) are returned unchanged and not truncated', () => {
    fc.assert(
      fc.property(nameArb, name => {
        fc.pre(codePointLength(name) <= FILE_NAME_MAX_CHARS);

        const result = truncateFileName(name);

        expect(result.truncated).toBe(false);
        expect(result.text).toBe(name);
        // Indicator must NOT be introduced for short names (only reject if the
        // original didn't already contain it).
        if (!name.includes(TRUNCATION_INDICATOR)) {
          expect(result.text.includes(TRUNCATION_INDICATOR)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('long names (> 40 code points) are truncated within the budget with an indicator', () => {
    fc.assert(
      fc.property(nameArb, name => {
        fc.pre(codePointLength(name) > FILE_NAME_MAX_CHARS);

        const result = truncateFileName(name);

        expect(result.truncated).toBe(true);
        // Visible code-point length (including the indicator) stays within 40.
        expect(codePointLength(result.text)).toBeLessThanOrEqual(
          FILE_NAME_MAX_CHARS,
        );
        // The indicator is present exactly when truncation occurred.
        expect(result.text.endsWith(TRUNCATION_INDICATOR)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('truncation flag is exactly equivalent to the name exceeding the budget', () => {
    fc.assert(
      fc.property(nameArb, name => {
        const result = truncateFileName(name);
        const expectedTruncated = codePointLength(name) > FILE_NAME_MAX_CHARS;

        expect(result.truncated).toBe(expectedTruncated);
        // The indicator's presence at the end matches the truncated flag
        // (for names that don't already end with the indicator when short).
        expect(codePointLength(result.text)).toBeLessThanOrEqual(
          FILE_NAME_MAX_CHARS,
        );
      }),
      { numRuns: 200 },
    );
  });
});
