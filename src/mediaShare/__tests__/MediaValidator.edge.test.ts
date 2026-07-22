/**
 * Simple Media Share - MediaValidator edge-case unit tests (task 2.4).
 *
 * Covers the validation boundaries for both an image and a video type:
 *   - size 0, exactly MAX_FILE_SIZE_BYTES, and one byte over
 * plus a combined unsupported-type-and-oversize input confirming that the
 * type message takes precedence over the size message.
 *
 * Validates: Requirements 3.3, 3.5
 */

import { MAX_FILE_SIZE_BYTES } from '../constants';
import {
  EXCEEDS_SIZE_MESSAGE,
  UNSUPPORTED_TYPE_MESSAGE,
  validateMediaItem,
} from '../MediaValidator';
import type { MediaItem } from '../types';

/** Build a MediaItem with the given MIME type and size for boundary testing. */
function makeItem(mimeType: string, sizeBytes: number): MediaItem {
  return {
    uri: 'file:///tmp/media',
    mimeType,
    sizeBytes,
    fileName: 'media',
  };
}

describe('validateMediaItem size boundaries (Requirement 3.3)', () => {
  describe.each([
    ['image', 'image/jpeg'],
    ['video', 'video/mp4'],
  ])('%s type (%s)', (_label, mimeType) => {
    it('accepts a size of 0 bytes', () => {
      expect(validateMediaItem(makeItem(mimeType, 0))).toEqual({ ready: true });
    });

    it('accepts a size exactly at MAX_FILE_SIZE_BYTES', () => {
      expect(
        validateMediaItem(makeItem(mimeType, MAX_FILE_SIZE_BYTES)),
      ).toEqual({ ready: true });
    });

    it('rejects a size one byte over MAX_FILE_SIZE_BYTES with exceeds_size', () => {
      const result = validateMediaItem(
        makeItem(mimeType, MAX_FILE_SIZE_BYTES + 1),
      );

      expect(result).toEqual({
        ready: false,
        reason: 'exceeds_size',
        message: EXCEEDS_SIZE_MESSAGE,
      });
    });
  });
});

describe('validateMediaItem type precedence over size (Requirement 3.5)', () => {
  it('returns unsupported_type (not exceeds_size) when the type is unsupported AND oversize', () => {
    const result = validateMediaItem(
      makeItem('application/pdf', MAX_FILE_SIZE_BYTES + 1),
    );

    expect(result).toEqual({
      ready: false,
      reason: 'unsupported_type',
      message: UNSUPPORTED_TYPE_MESSAGE,
    });
  });

  it('does not surface the size message when the type is also unsupported', () => {
    const result = validateMediaItem(
      makeItem('application/pdf', MAX_FILE_SIZE_BYTES + 1),
    );

    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.reason).not.toBe('exceeds_size');
      expect(result.message).not.toBe(EXCEEDS_SIZE_MESSAGE);
    }
  });
});
