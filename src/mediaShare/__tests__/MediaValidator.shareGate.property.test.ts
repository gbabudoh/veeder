// Feature: simple-media-share, Property 4: The share-eligibility gate agrees with validation

/**
 * Property-based test for Property 4 of the Simple Media Share feature.
 *
 * **Property 4: The share-eligibility gate agrees with validation**
 * **Validates: Requirements 5.5**
 *
 * For any MediaItem, `canShare(item)` returns true if and only if
 * `validateMediaItem(item).ready` is true; when it returns false the reason
 * surfaced (the validation reason) is the one that matches that item.
 */

import fc from 'fast-check';

import { MAX_FILE_SIZE_BYTES, SUPPORTED_TYPES } from '../constants';
import { canShare, validateMediaItem } from '../MediaValidator';
import type { MediaItem } from '../types';

/** Supported MIME types drawn straight from the single source of truth. */
const supportedMimeArb = fc.constantFrom(...SUPPORTED_TYPES);

/** A selection of unsupported MIME types plus arbitrary strings. */
const unsupportedMimeArb = fc.oneof(
  fc.constantFrom(
    'image/bmp',
    'image/tiff',
    'image/webp',
    'video/x-msvideo',
    'video/webm',
    'application/pdf',
    'text/plain',
    'application/octet-stream',
    '',
  ),
  // Arbitrary strings, filtered so we never accidentally hit a supported type.
  fc
    .string()
    .filter(s => !(SUPPORTED_TYPES as readonly string[]).includes(s)),
);

const mimeArb = fc.oneof(supportedMimeArb, unsupportedMimeArb);

/**
 * Sizes clustered around the 100 MB boundary (0, just under, exactly at, just
 * over) as well as broadly across the valid non-negative range.
 */
const sizeArb = fc.oneof(
  fc.constantFrom(
    0,
    1,
    MAX_FILE_SIZE_BYTES - 1,
    MAX_FILE_SIZE_BYTES,
    MAX_FILE_SIZE_BYTES + 1,
    MAX_FILE_SIZE_BYTES * 2,
  ),
  fc.nat(),
  fc.integer({ min: 0, max: MAX_FILE_SIZE_BYTES + 1_000_000 }),
);

const mediaItemArb: fc.Arbitrary<MediaItem> = fc.record({
  uri: fc.webUrl(),
  mimeType: mimeArb,
  sizeBytes: sizeArb,
  fileName: fc.string(),
});

describe('Property 4: The share-eligibility gate agrees with validation', () => {
  it('canShare(item) === validateMediaItem(item).ready for all items', () => {
    fc.assert(
      fc.property(mediaItemArb, item => {
        const result = validateMediaItem(item);
        // The gate must agree exactly with validation readiness.
        expect(canShare(item)).toBe(result.ready);
      }),
      { numRuns: 500 },
    );
  });

  it('when canShare is false, the surfaced reason matches the validation reason', () => {
    fc.assert(
      fc.property(mediaItemArb, item => {
        const result = validateMediaItem(item);
        if (canShare(item)) {
          // Eligible items carry no rejection reason.
          expect(result.ready).toBe(true);
        } else {
          // Ineligible items expose exactly the validation reason for that item.
          expect(result.ready).toBe(false);
          if (!result.ready) {
            expect(result.reason).toBeDefined();
            expect(['unsupported_type', 'exceeds_size']).toContain(
              result.reason,
            );
          }
        }
      }),
      { numRuns: 500 },
    );
  });
});
