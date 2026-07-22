// Feature: simple-media-share, Property 3: Media validation classifies type and size with type precedence

import fc from 'fast-check';

import { MAX_FILE_SIZE_BYTES, SUPPORTED_TYPES } from '../constants';
import {
  EXCEEDS_SIZE_MESSAGE,
  UNSUPPORTED_TYPE_MESSAGE,
  validateMediaItem,
} from '../MediaValidator';
import type { MediaItem } from '../types';

/**
 * Property 3 (Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5)
 *
 * For any MediaItem, validateMediaItem returns ready:true iff the MIME type is
 * in SUPPORTED_TYPES AND sizeBytes <= MAX_FILE_SIZE_BYTES. Otherwise it returns
 * ready:false with exactly one reason: 'unsupported_type' whenever the type is
 * unsupported (regardless of size), and 'exceeds_size' only when the type is
 * supported but the size exceeds the limit. The size message is never present
 * when the type is unsupported.
 */

// A MIME type drawn from the supported set.
const supportedMimeArb = fc.constantFrom(
  ...(SUPPORTED_TYPES as readonly string[]),
);

// Arbitrary strings that are NOT in the supported set (unsupported types).
const unsupportedMimeArb = fc
  .oneof(
    fc.string(),
    fc.constantFrom(
      '',
      'image/bmp',
      'image/webp',
      'video/x-msvideo',
      'application/pdf',
      'text/plain',
      'image/jpg', // note: not the same as image/jpeg
      'IMAGE/JPEG', // case-sensitive: not supported
    ),
  )
  .filter(mime => !(SUPPORTED_TYPES as readonly string[]).includes(mime));

// Any MIME type (supported or not).
const anyMimeArb = fc.oneof(supportedMimeArb, unsupportedMimeArb);

// Sizes that cover the 100 MB boundary: 0, just under, exactly at, just over,
// and arbitrarily larger, plus a broad random range.
const sizeArb = fc.oneof(
  fc.constant(0),
  fc.constant(1),
  fc.constant(MAX_FILE_SIZE_BYTES - 1),
  fc.constant(MAX_FILE_SIZE_BYTES),
  fc.constant(MAX_FILE_SIZE_BYTES + 1),
  fc.integer({ min: 0, max: MAX_FILE_SIZE_BYTES }),
  fc.integer({ min: MAX_FILE_SIZE_BYTES, max: MAX_FILE_SIZE_BYTES * 4 }),
);

const mediaItemArb = (mimeArb: fc.Arbitrary<string>): fc.Arbitrary<MediaItem> =>
  fc.record({
    uri: fc.webUrl(),
    mimeType: mimeArb,
    sizeBytes: sizeArb,
    fileName: fc.string(),
  });

const isSupported = (mime: string): boolean =>
  (SUPPORTED_TYPES as readonly string[]).includes(mime);

describe('validateMediaItem - Property 3: type/size classification with type precedence', () => {
  it('returns ready:true iff supported type AND within size; otherwise exactly one correct reason', () => {
    fc.assert(
      fc.property(mediaItemArb(anyMimeArb), item => {
        const result = validateMediaItem(item);

        const supported = isSupported(item.mimeType);
        const withinSize = item.sizeBytes <= MAX_FILE_SIZE_BYTES;
        const expectedReady = supported && withinSize;

        // Readiness matches the iff condition.
        expect(result.ready).toBe(expectedReady);

        if (result.ready) {
          // ready:true carries no reason/message at all.
          expect(result).toEqual({ ready: true });
          return;
        }

        // ready:false must carry exactly one reason.
        expect(result.reason === 'unsupported_type' || result.reason === 'exceeds_size').toBe(true);

        if (!supported) {
          // Type precedence: unsupported type wins regardless of size.
          expect(result.reason).toBe('unsupported_type');
          expect(result.message).toBe(UNSUPPORTED_TYPE_MESSAGE);
          // The size message is never present when the type is unsupported.
          expect(result.message).not.toBe(EXCEEDS_SIZE_MESSAGE);
        } else {
          // Supported but oversize is the only remaining not-ready case.
          expect(result.reason).toBe('exceeds_size');
          expect(result.message).toBe(EXCEEDS_SIZE_MESSAGE);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('exceeds_size is only ever returned for supported types (never together with the type message)', () => {
    fc.assert(
      fc.property(mediaItemArb(anyMimeArb), item => {
        const result = validateMediaItem(item);
        if (!result.ready && result.reason === 'exceeds_size') {
          expect(isSupported(item.mimeType)).toBe(true);
          expect(item.sizeBytes).toBeGreaterThan(MAX_FILE_SIZE_BYTES);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('a supported type with an unsupported-by-size item still reports type precedence when type is unsupported', () => {
    // Force items that are both unsupported type AND oversize to confirm
    // the size message is suppressed (Requirement 3.5).
    const oversizeArb = fc.integer({
      min: MAX_FILE_SIZE_BYTES + 1,
      max: MAX_FILE_SIZE_BYTES * 4,
    });
    fc.assert(
      fc.property(
        fc.record({
          uri: fc.webUrl(),
          mimeType: unsupportedMimeArb,
          sizeBytes: oversizeArb,
          fileName: fc.string(),
        }),
        item => {
          const result = validateMediaItem(item);
          expect(result.ready).toBe(false);
          if (!result.ready) {
            expect(result.reason).toBe('unsupported_type');
            expect(result.message).toBe(UNSUPPORTED_TYPE_MESSAGE);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
