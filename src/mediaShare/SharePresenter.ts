/**
 * Simple Media Share - SharePresenter (native adapter).
 *
 * Thin wrapper over `react-native-share` that attaches a validated
 * MediaItem's file URL and opens the OS share sheet, then maps the library's
 * resolve/reject outcomes onto the feature's `ShareResult` contract
 * (Requirements 5.1, 5.2).
 *
 * Result mapping (see design "Error Handling"):
 * - A successful resolve (the share sheet opened and the user completed or
 *   proceeded with a share)            -> 'shared'
 * - A user dismissal / cancellation    -> 'dismissed'
 * - Any other failure to open the sheet -> 'failed'
 *
 * `react-native-share` reports a user dismissal in two ways depending on the
 * platform and version: it may resolve with `{ success: false, dismissedAction:
 * true }`, or it may reject with an error whose message indicates the user did
 * not share (e.g. "User did not share"). Both are treated as 'dismissed'.
 */

import Share from 'react-native-share';

import type { MediaItem, ShareResult } from './types';

/**
 * Substrings that identify a user-initiated dismissal in a rejected share
 * error message. Matching is case-insensitive.
 */
const DISMISSAL_MESSAGE_MARKERS: readonly string[] = [
  'user did not share',
  'did not share',
  'user cancelled',
  'user canceled',
  'cancelled',
  'canceled',
  'dismiss',
];

/**
 * Extract a lowercased message string from an unknown thrown value.
 */
function errorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error.toLowerCase();
  }
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') {
      return maybeMessage.toLowerCase();
    }
  }
  return '';
}

/**
 * Returns true when a rejected share error represents a user dismissal rather
 * than a genuine failure to open the share sheet.
 */
function isDismissal(error: unknown): boolean {
  const message = errorMessage(error);
  if (!message) {
    return false;
  }
  return DISMISSAL_MESSAGE_MARKERS.some(marker => message.includes(marker));
}

/**
 * Open the OS share sheet with the given item attached and map the outcome to
 * a `ShareResult`.
 *
 * The caller is responsible for ensuring the item is share-eligible
 * (`canShare`) before invoking this; this adapter only performs the effect and
 * reports the outcome.
 */
export async function present(item: MediaItem): Promise<ShareResult> {
  try {
    const response = await Share.open({
      url: item.uri,
      type: item.mimeType,
      filename: item.fileName,
    });

    // Some platforms/versions signal a dismissal on the resolve path rather
    // than rejecting. Treat that as 'dismissed'.
    if (
      response &&
      typeof response === 'object' &&
      (response as { dismissedAction?: boolean }).dismissedAction === true
    ) {
      return 'dismissed';
    }

    return 'shared';
  } catch (error) {
    if (isDismissal(error)) {
      return 'dismissed';
    }
    return 'failed';
  }
}
