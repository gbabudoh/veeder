/**
 * Simple Media Share - MediaValidator (pure).
 *
 * The single source of truth for media type/size validation. The same
 * `validateMediaItem` result drives whether an item is marked "ready to share"
 * (Requirement 3) and whether the share action may proceed (Requirement 5.5),
 * so there is no second, divergent check that could disagree.
 *
 * Type is checked before size so that an item that is both an unsupported type
 * and oversized returns the single reason `unsupported_type`, and the size
 * message is never shown alongside the type message (Requirement 3.5).
 */

import { MAX_FILE_SIZE_BYTES, SUPPORTED_TYPES } from './constants';
import type { MediaItem, ValidationResult } from './types';

/**
 * User-facing message shown when the selected file's type is not supported
 * (Requirement 3.2).
 */
export const UNSUPPORTED_TYPE_MESSAGE =
  'This file type is not supported. Choose a JPEG, PNG, GIF, MP4, or QuickTime file.';

/**
 * User-facing message shown when a supported file exceeds the size limit
 * (Requirement 3.3).
 */
export const EXCEEDS_SIZE_MESSAGE =
  'This file exceeds the 100 MB limit. Choose a smaller file.';

/**
 * Validate a MediaItem against the supported types and maximum file size.
 *
 * Returns `{ ready: true }` if and only if the item's MIME type is in
 * `SUPPORTED_TYPES` and its `sizeBytes` is within `MAX_FILE_SIZE_BYTES`
 * (i.e. `sizeBytes <= MAX_FILE_SIZE_BYTES`).
 *
 * Otherwise returns `{ ready: false }` with exactly one reason:
 * - `unsupported_type` whenever the type is unsupported, regardless of size
 *   (type precedence, Requirement 3.5).
 * - `exceeds_size` only when the type is supported but the size exceeds the
 *   limit (Requirement 3.3).
 */
export function validateMediaItem(item: MediaItem): ValidationResult {
  const isSupportedType = (SUPPORTED_TYPES as readonly string[]).includes(
    item.mimeType,
  );

  // Type precedence: unsupported type wins over oversize (Requirement 3.5).
  if (!isSupportedType) {
    return {
      ready: false,
      reason: 'unsupported_type',
      message: UNSUPPORTED_TYPE_MESSAGE,
    };
  }

  // Supported type but oversize (Requirement 3.3).
  if (item.sizeBytes > MAX_FILE_SIZE_BYTES) {
    return {
      ready: false,
      reason: 'exceeds_size',
      message: EXCEEDS_SIZE_MESSAGE,
    };
  }

  // Supported type and within size (Requirement 3.4).
  return { ready: true };
}

/**
 * The share-eligibility gate. Returns true if and only if
 * `validateMediaItem(item).ready` is true (Requirement 5.5).
 */
export function canShare(item: MediaItem): boolean {
  return validateMediaItem(item).ready;
}
