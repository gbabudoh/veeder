/**
 * Simple Media Share - shared domain types.
 *
 * These types define the contracts shared across the feature's pure decision
 * core (permission resolution, media validation, name truncation) and the thin
 * native adapters (permissions, picker, share). They mirror the illustrative
 * TypeScript contracts in the design document.
 */

// ---- Domain types ----

/**
 * The set of MIME types the feature is allowed to share (Supported_Media_Type).
 */
export type SupportedMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'video/mp4'
  | 'video/quicktime';

/**
 * A single image or video file selected by the user.
 */
export interface MediaItem {
  /** Platform file/content URI of the picked asset. */
  uri: string;
  /** Reported MIME type; may be any string until validated. */
  mimeType: string;
  /** Non-negative byte count; compared to MAX_FILE_SIZE_BYTES. */
  sizeBytes: number;
  /** Display name; truncated for presentation beyond FILE_NAME_MAX_CHARS. */
  fileName: string;
}

// ---- Permission model ----

/**
 * Resolved media-library permission status.
 */
export type PermissionStatus =
  | 'not_determined' // never asked -> should request
  | 'granted' // proceed to picker
  | 'denied' // non-permanent denial -> "access required" message
  | 'blocked' // permanently denied -> "enable in settings" message
  | 'error'; // request timed out / failed -> "could not obtain" message

/**
 * The outcome a resolved permission status maps to.
 */
export type PermissionOutcome =
  | { action: 'open_picker' }
  | {
      action: 'show_message';
      kind: 'access_required' | 'open_settings' | 'unavailable';
    };

// ---- Validation model ----

/**
 * Result of validating a MediaItem's type and size. When not ready, exactly one
 * ordered reason is returned (type precedence over size).
 */
export type ValidationResult =
  | { ready: true }
  | {
      ready: false;
      reason: 'unsupported_type' | 'exceeds_size';
      message: string;
    };

// ---- Picker adapter ----

/**
 * The normalized result of opening the native media picker.
 */
export type PickResult =
  | { kind: 'selected'; item: MediaItem }
  | { kind: 'cancelled' }
  | { kind: 'empty' } // no supported items available
  | { kind: 'rejected_oversize'; item: MediaItem }; // picker-level size reject

// ---- Preview ----

/**
 * The presentation model for the preview area. A failed preview degrades to
 * 'unavailable' but never blocks sharing.
 */
export type PreviewModel =
  | { kind: 'image'; uri: string; displayName: string }
  | {
      kind: 'video';
      frameUri: string;
      displayName: string;
      showPlayIndicator: true;
    }
  | { kind: 'unavailable'; displayName: string };

// ---- Share adapter ----

/**
 * The outcome of invoking the native share sheet.
 */
export type ShareResult = 'shared' | 'dismissed' | 'failed';

// ---- Controller state ----

/**
 * The finite set of states the MediaShareController moves through.
 */
export type ShareState =
  | { name: 'Idle' }
  | { name: 'RequestingPermission' }
  | { name: 'PermissionDenied' } // access-required message
  | { name: 'PermissionBlocked' } // open-settings message
  | { name: 'PermissionError' } // could-not-obtain message
  | { name: 'PickerOpen' }
  | { name: 'Validating'; item: MediaItem }
  | { name: 'Ready'; item: MediaItem; preview: PreviewModel }
  | { name: 'Sharing'; item: MediaItem };
