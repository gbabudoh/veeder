/**
 * Simple Media Share - PermissionManager.
 *
 * Wraps the media-library permission surface. The decision logic is a pure,
 * dependency-free function (`resolvePermissionOutcome`) that maps a resolved
 * permission status to the outcome the flow must take. The effectful
 * `ensurePermission` (which talks to the native permissions module) is
 * implemented separately.
 */

import {Platform} from 'react-native';
import {
  PERMISSIONS,
  RESULTS,
  check,
  request,
  type Permission,
  type PermissionStatus as RNPermissionStatus,
} from 'react-native-permissions';

import type {PermissionOutcome, PermissionStatus} from './types';

/**
 * Pure decision table: maps a resolved permission status to the required
 * outcome.
 *
 * - `granted`        -> open the picker.
 * - `denied`         -> show the "media access is required" message.
 * - `blocked`        -> show the "enable media access in settings" message.
 * - `error`          -> show the "media access could not be obtained" message.
 * - `not_determined` -> treated as not granted (fail-safe): show the
 *                       "unavailable" message rather than opening the picker.
 *
 * The picker is opened if and only if the status is `granted`; every
 * non-granted status resolves to a `show_message` outcome and never opens the
 * picker.
 *
 * Requirements: 1.2, 1.3, 1.5, 1.6
 */
export function resolvePermissionOutcome(
  status: PermissionStatus,
): PermissionOutcome {
  switch (status) {
    case 'granted':
      return {action: 'open_picker'};
    case 'denied':
      return {action: 'show_message', kind: 'access_required'};
    case 'blocked':
      return {action: 'show_message', kind: 'open_settings'};
    case 'error':
      return {action: 'show_message', kind: 'unavailable'};
    case 'not_determined':
      // A status that has not resolved to a grant is treated as not granted;
      // the picker is never opened on uncertainty.
      return {action: 'show_message', kind: 'unavailable'};
    default: {
      // Exhaustiveness guard: if PermissionStatus gains a new member, this
      // fails to compile. At runtime, fall back to the fail-safe outcome.
      const _exhaustive: never = status;
      void _exhaustive;
      return {action: 'show_message', kind: 'unavailable'};
    }
  }
}

/**
 * Maximum time to wait for the OS permission request to return a result before
 * treating it as failed (Requirement 1.6).
 */
const PERMISSION_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Resolves the platform-appropriate media-library permission to check/request.
 *
 * - iOS: the photo library permission.
 * - Android 13+ (API level 33+): the granular READ_MEDIA_IMAGES permission
 *   introduced with scoped media access.
 * - Older Android: the legacy READ_EXTERNAL_STORAGE permission.
 *
 * Returns `null` on any platform where a media-library permission is not
 * modelled, so the caller can fail safe.
 */
function getMediaLibraryPermission(): Permission | null {
  return Platform.select<Permission | null>({
    ios: PERMISSIONS.IOS.PHOTO_LIBRARY,
    android:
      typeof Platform.Version === 'number' && Platform.Version >= 33
        ? PERMISSIONS.ANDROID.READ_MEDIA_IMAGES
        : PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE,
    default: null,
  }) ?? null;
}

/**
 * Maps a `react-native-permissions` RESULTS value to the feature's
 * `PermissionStatus`.
 *
 * The interpretation of `DENIED` and `UNAVAILABLE` depends on whether the value
 * came from an initial `check` or from an issued `request`:
 *
 * - `GRANTED` / `LIMITED`        -> `granted`.
 * - `BLOCKED`                    -> `blocked` (permanently denied).
 * - `DENIED` before a request    -> `not_determined` (the OS reports it as
 *                                   requestable, so we should still ask).
 * - `DENIED` after a request     -> `denied` (the User actively declined).
 * - `UNAVAILABLE` before request -> `not_determined` (attempt a request).
 * - `UNAVAILABLE` after request  -> `error` (fail safe; treat as not granted).
 */
function mapNativeStatus(
  result: RNPermissionStatus,
  afterRequest: boolean,
): PermissionStatus {
  switch (result) {
    case RESULTS.GRANTED:
    case RESULTS.LIMITED:
      return 'granted';
    case RESULTS.BLOCKED:
      return 'blocked';
    case RESULTS.DENIED:
      return afterRequest ? 'denied' : 'not_determined';
    case RESULTS.UNAVAILABLE:
      return afterRequest ? 'error' : 'not_determined';
    default:
      // Any unexpected value is treated as not granted (fail-safe).
      return 'error';
  }
}

/**
 * Effectful media-library permission gate.
 *
 * Checks the current permission status first, and issues an OS permission
 * request **only** when the current status is undetermined; any already-resolved
 * status (`granted`, `denied`, `blocked`) is returned without issuing a new
 * request (Requirements 1.1, 1.4). The request itself is issued promptly and is
 * wrapped in a 10-second timeout that resolves to `error` so an unresponsive OS
 * prompt is treated as not granted (Requirement 1.6).
 *
 * Requirements: 1.1, 1.4, 1.6
 */
export async function ensurePermission(): Promise<PermissionStatus> {
  const permission = getMediaLibraryPermission();
  if (permission === null) {
    // No media-library permission is modelled for this platform; fail safe.
    return 'error';
  }

  // 1. Check the current status without prompting the User.
  const current = mapNativeStatus(await check(permission), false);

  // 2. Only issue a new OS request when the status is undetermined.
  if (current !== 'not_determined') {
    return current;
  }

  // 3. Issue the request promptly, racing it against a 10s timeout that
  //    resolves to `error` (treated as not granted).
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PermissionStatus>(resolve => {
    timeoutHandle = setTimeout(
      () => resolve('error'),
      PERMISSION_REQUEST_TIMEOUT_MS,
    );
  });

  const requested = request(permission).then(
    (result: RNPermissionStatus) => mapNativeStatus(result, true),
  );

  try {
    return await Promise.race([requested, timeout]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}
