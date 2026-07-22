/**
 * Simple Media Share - MediaPicker adapter (thin native shell).
 *
 * Wraps `react-native-image-picker`'s `launchImageLibrary` behind the narrow
 * `MediaPicker` interface from the design. The native library owns the platform
 * media library UI and single-item selection; this adapter only configures the
 * request, normalizes the returned native asset into a `MediaItem`, and
 * classifies the outcome into a `PickResult`.
 *
 * Classification (design Error Handling / Requirement 2):
 * - user dismissed the picker            -> `cancelled` (Req 2.3)
 * - a valid asset within the size limit   -> `selected` (Req 2.2)
 * - an asset larger than the size limit   -> `rejected_oversize` (Req 2.5)
 * - no usable asset (empty / error)       -> `empty` (Req 2.6)
 *
 * The picker is configured with `mediaType: 'mixed'` (images and videos) and
 * `selectionLimit: 1` so exactly one item is chosen per share action
 * (Req 2.1, 2.4). Type filtering to the supported set is enforced downstream by
 * `MediaValidator`; the native picker only narrows to images/videos.
 */

import {
  launchImageLibrary,
  type Asset,
  type ImageLibraryOptions,
  type ImagePickerResponse,
} from 'react-native-image-picker';

import { MAX_FILE_SIZE_BYTES } from './constants';
import type { MediaItem, PickResult } from './types';

/**
 * Options passed to the native library. `mediaType: 'mixed'` surfaces both
 * images and videos, and `selectionLimit: 1` enforces single selection
 * (Req 2.1, 2.4). `includeExtra` ensures fields such as `fileSize` and
 * `fileName` are populated so the asset can be normalized and size-checked.
 */
const PICKER_OPTIONS: ImageLibraryOptions = {
  mediaType: 'mixed',
  selectionLimit: 1,
  includeExtra: true,
};

/**
 * Normalize a native picker asset into a `MediaItem`.
 *
 * The native asset uses `type` for the MIME type and `fileSize` for the byte
 * count; both may be absent depending on platform. Missing numeric size is
 * treated as 0 and missing strings as empty so the resulting `MediaItem` always
 * satisfies its contract; final type/size validation is performed by
 * `MediaValidator`.
 */
function normalizeAsset(asset: Asset): MediaItem {
  return {
    uri: asset.uri ?? '',
    mimeType: asset.type ?? '',
    sizeBytes: asset.fileSize ?? 0,
    fileName: asset.fileName ?? '',
  };
}

/**
 * Pick the single usable asset from a native response, if any.
 *
 * Returns `undefined` when the response carries no assets or the first asset
 * has no URI (nothing shareable was produced).
 */
function firstUsableAsset(response: ImagePickerResponse): Asset | undefined {
  const asset = response.assets?.[0];
  if (!asset || !asset.uri) {
    return undefined;
  }
  return asset;
}

/**
 * Open the native media library and return a normalized `PickResult`.
 *
 * The result is classified as follows:
 * - `cancelled` when the user dismissed the picker (`didCancel`).
 * - `empty` when the picker produced no usable asset, including error
 *   responses and empty libraries (the no-asset case).
 * - `rejected_oversize` when the chosen asset exceeds `MAX_FILE_SIZE_BYTES`.
 * - `selected` when a valid asset within the size limit was chosen.
 */
export async function open(): Promise<PickResult> {
  const response = await launchImageLibrary(PICKER_OPTIONS);

  // The user closed the picker without selecting anything (Req 2.3).
  if (response.didCancel) {
    return { kind: 'cancelled' };
  }

  // No usable asset was returned (empty library, or an error surfaced with no
  // asset). Treated as the empty state (Req 2.6).
  const asset = firstUsableAsset(response);
  if (!asset) {
    return { kind: 'empty' };
  }

  const item = normalizeAsset(asset);

  // Picker-level size rejection: retain the picker open and surface the
  // over-size error upstream (Req 2.5).
  if (item.sizeBytes > MAX_FILE_SIZE_BYTES) {
    return { kind: 'rejected_oversize', item };
  }

  // A valid asset within the size limit (Req 2.2).
  return { kind: 'selected', item };
}

/**
 * The MediaPicker adapter, exposing the design's narrow interface.
 */
export const MediaPicker = { open };
