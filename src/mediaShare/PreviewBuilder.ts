/**
 * Simple Media Share - PreviewBuilder.
 *
 * Builds the presentation model for the preview area and handles file-name
 * truncation. This file currently implements only the pure `truncateFileName`
 * helper; the effectful async `build` method is implemented separately.
 */

import { FILE_NAME_MAX_CHARS } from './constants';
import type { MediaItem, PreviewModel } from './types';

/**
 * Time budget for generating a preview (Req 4.1, 4.2, 4.3). If a preview cannot
 * be produced within this window, the builder degrades to an 'unavailable'
 * placeholder so the share control stays enabled.
 */
const PREVIEW_BUDGET_MS = 2000;

/**
 * The single-character ellipsis used as the visible truncation indicator. It is
 * one user-perceived character (one code point) and is counted within the
 * FILE_NAME_MAX_CHARS budget.
 */
const TRUNCATION_INDICATOR = '\u2026'; // …

/**
 * Truncate a file name for presentation (Req 4.4).
 *
 * "Visible length" is measured in user-perceived characters. To avoid splitting
 * multi-byte characters, emoji, or surrogate pairs, the name is measured and
 * sliced by Unicode code points (via the string iterator) rather than by
 * UTF-16 code units.
 *
 * - When the name is at most FILE_NAME_MAX_CHARS (40) code points long, the
 *   original text is returned unchanged with `truncated: false`.
 * - Otherwise the text is shortened so that the result — including the
 *   truncation indicator — does not exceed FILE_NAME_MAX_CHARS code points, and
 *   `truncated: true` is returned.
 *
 * @param name The raw file name to present.
 * @returns The display text and whether truncation was applied.
 */
export function truncateFileName(name: string): {
  text: string;
  truncated: boolean;
} {
  // Count and split by code points so multi-byte characters stay intact.
  const codePoints = Array.from(name);

  if (codePoints.length <= FILE_NAME_MAX_CHARS) {
    return { text: name, truncated: false };
  }

  // Reserve one slot for the truncation indicator so the total visible length
  // (kept content + indicator) stays within the budget.
  const keep = Math.max(FILE_NAME_MAX_CHARS - TRUNCATION_INDICATOR.length, 0);
  const text = codePoints.slice(0, keep).join('') + TRUNCATION_INDICATOR;

  return { text, truncated: true };
}

/**
 * A rejection used internally to signal that preview generation exceeded the
 * time budget. Any rejection (timeout or otherwise) collapses to 'unavailable'.
 */
const TIMEOUT = Symbol('preview-timeout');

/**
 * Resolve the value of `promise`, or reject with {@link TIMEOUT} once
 * `PREVIEW_BUDGET_MS` elapses — whichever happens first. The pending timer is
 * always cleared so it never keeps the runtime awake after settling.
 */
function withBudget<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(TIMEOUT), PREVIEW_BUDGET_MS);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Attempt to derive a first-frame preview URI for a video.
 *
 * React Native has no built-in frame-extraction API and the design does not
 * mandate a specific library, so this uses a pragmatic, dependency-free
 * approach: the video's own URI is offered as the frame source, which the
 * common RN video/thumbnail components accept directly. If a usable URI is not
 * available, the caller degrades the preview to 'unavailable' within the
 * 2-second budget.
 */
async function deriveVideoFrameUri(item: MediaItem): Promise<string> {
  if (!item.uri) {
    throw new Error('No video URI available for frame extraction');
  }

  return item.uri;
}

/**
 * Build the preview presentation model for a selected media item (Req 4.1-4.3).
 *
 * The item is classified by MIME type: an `image/*` type yields an image
 * preview, a `video/*` type yields a first-frame preview with a play indicator.
 * Preview generation is bounded by a 2-second budget via {@link withBudget}. On
 * timeout, on any failure, or for an unrecognized type, the builder returns an
 * `unavailable` placeholder so the selection is retained and the share control
 * stays enabled (Req 4.3).
 *
 * @param item The media item to preview.
 * @returns The preview model to render.
 */
export async function build(item: MediaItem): Promise<PreviewModel> {
  const displayName = truncateFileName(item.fileName).text;

  try {
    return await withBudget(
      (async (): Promise<PreviewModel> => {
        const mimeType = item.mimeType ?? '';

        if (mimeType.startsWith('image/')) {
          return { kind: 'image', uri: item.uri, displayName };
        }

        if (mimeType.startsWith('video/')) {
          const frameUri = await deriveVideoFrameUri(item);
          return {
            kind: 'video',
            frameUri,
            displayName,
            showPlayIndicator: true,
          };
        }

        // Unrecognized type -> fall back to the placeholder.
        throw new Error(`Unsupported preview type: ${mimeType}`);
      })(),
    );
  } catch {
    // Timeout or any failure degrades to a placeholder (Req 4.3).
    return { kind: 'unavailable', displayName };
  }
}
