/**
 * Simple Media Share - shared constants.
 *
 * These values are the single source of truth for the supported media types,
 * the maximum allowed file size, and the file-name truncation budget.
 */

import type { SupportedMediaType } from './types';

/**
 * The MIME types the feature is allowed to share (Supported_Media_Type).
 */
export const SUPPORTED_TYPES: readonly SupportedMediaType[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'video/mp4',
  'video/quicktime',
];

/**
 * Maximum allowed file size in bytes (100 MB, Maximum_File_Size).
 */
export const MAX_FILE_SIZE_BYTES = 104857600; // 100 * 1024 * 1024

/**
 * Maximum number of characters shown for a file name before truncation.
 */
export const FILE_NAME_MAX_CHARS = 40;
