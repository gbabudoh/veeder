/**
 * Simple Media Share - MediaShareController (state machine).
 *
 * Owns the feature's `ShareState` and sequences the flow across the collaborators:
 *
 *   Idle
 *     -> RequestingPermission
 *          -> PickerOpen                        (granted)
 *          -> PermissionDenied                  (denied / access-required)
 *          -> PermissionBlocked                 (blocked / open-settings)
 *          -> PermissionError                   (error / not-granted)
 *     PickerOpen
 *          -> Validating -> Ready               (item selected + validates ready)
 *          -> Idle                              (item selected but not ready)
 *          -> (prior state)                     (cancelled, selection unchanged)
 *          -> PickerOpen                        (oversize / empty, error surfaced)
 *     Ready
 *          -> Sharing -> Ready                  (share attempted, item retained)
 *
 * The controller is deterministic and free of React specifics; the screen
 * (task 9.1) binds to it via {@link MediaShareController.getSnapshot} /
 * {@link MediaShareController.subscribe}. Collaborators are injected behind the
 * narrow interfaces below so they can be mocked in the property tests
 * (tasks 8.2-8.4).
 *
 * Requirements: 1.2, 2.2, 2.3, 2.5, 3.6, 4.5, 5.3, 5.4
 */

import {
  canShare as defaultCanShare,
  validateMediaItem as defaultValidateMediaItem,
} from './MediaValidator';
import { open as defaultPickerOpen } from './MediaPicker';
import {
  ensurePermission as defaultEnsurePermission,
  resolvePermissionOutcome as defaultResolvePermissionOutcome,
} from './PermissionManager';
import {
  build as defaultBuildPreview,
  truncateFileName as defaultTruncateFileName,
} from './PreviewBuilder';
import { present as defaultPresent } from './SharePresenter';
import type {
  MediaItem,
  PermissionOutcome,
  PermissionStatus,
  PickResult,
  PreviewModel,
  ShareResult,
  ShareState,
  ValidationResult,
} from './types';

// ---- Collaborator interfaces (narrow, mockable) ----

/**
 * Permission gate: resolves the current media-library permission status and
 * maps it to the outcome the flow must take.
 */
export interface PermissionGate {
  ensurePermission(): Promise<PermissionStatus>;
  resolvePermissionOutcome(status: PermissionStatus): PermissionOutcome;
}

/**
 * Media picker: opens the native library and returns a normalized result.
 */
export interface Picker {
  open(): Promise<PickResult>;
}

/**
 * Validator: the single source of truth for type/size validation and the
 * share-eligibility gate.
 */
export interface Validator {
  validateMediaItem(item: MediaItem): ValidationResult;
  canShare(item: MediaItem): boolean;
}

/**
 * Preview builder: produces the preview presentation model and truncates names.
 */
export interface PreviewBuilderPort {
  build(item: MediaItem): Promise<PreviewModel>;
  truncateFileName(name: string): { text: string; truncated: boolean };
}

/**
 * Share presenter: opens the OS share sheet and reports the outcome.
 */
export interface SharePresenterPort {
  present(item: MediaItem): Promise<ShareResult>;
}

/**
 * The full set of collaborators the controller depends on.
 */
export interface MediaShareControllerDeps {
  permissionGate: PermissionGate;
  picker: Picker;
  validator: Validator;
  previewBuilder: PreviewBuilderPort;
  sharePresenter: SharePresenterPort;
}

// ---- Controller-facing messages ----

/**
 * The kind of user-facing message currently surfaced by the controller. Each
 * corresponds to a specific permission / validation / picker / share outcome.
 */
export type ControllerMessageKind =
  | 'access_required' // permission denied (non-permanent)  (Req 1.3)
  | 'open_settings' // permission blocked (permanent)      (Req 1.5)
  | 'permission_unavailable' // permission error / timeout  (Req 1.6)
  | 'empty' // no shareable items in library               (Req 2.6)
  | 'oversize' // picker-level over-size rejection          (Req 2.5)
  | 'unsupported_type' // validation: unsupported type      (Req 3.2)
  | 'exceeds_size' // validation: supported but oversize     (Req 3.3)
  | 'preview_unavailable' // preview could not be generated  (Req 4.3)
  | 'share_unavailable' // share sheet failed to open        (Req 5.4)
  | 'cannot_share'; // share attempted on ineligible item    (Req 5.5)

/**
 * A user-facing, non-blocking message surfaced alongside the current state.
 */
export interface ControllerMessage {
  kind: ControllerMessageKind;
  text: string;
}

/**
 * The immutable snapshot the UI binds to: the current state plus any surfaced
 * message.
 */
export interface ControllerSnapshot {
  state: ShareState;
  message: ControllerMessage | null;
}

/**
 * A subscriber invoked with the latest snapshot whenever it changes.
 */
export type ControllerListener = (snapshot: ControllerSnapshot) => void;

// ---- Message text (single source of truth) ----

export const ACCESS_REQUIRED_MESSAGE =
  'Media access is required to share media.';
export const OPEN_SETTINGS_MESSAGE =
  'Enable media access in your device settings to share media.';
export const PERMISSION_UNAVAILABLE_MESSAGE =
  'Media access could not be obtained. Please try again.';
export const EMPTY_LIBRARY_MESSAGE = 'No shareable items are available.';
export const OVERSIZE_MESSAGE =
  'This item exceeds the 100 MB limit. Choose a smaller item.';
export const PREVIEW_UNAVAILABLE_MESSAGE = 'Preview unavailable.';
export const SHARE_UNAVAILABLE_MESSAGE =
  'Sharing is currently unavailable. Please try again.';

// ---- Controller ----

/**
 * Sequences the media-share flow and owns the `ShareState`. All transitions go
 * through {@link MediaShareController.update} so subscribers always observe a
 * consistent snapshot.
 */
export class MediaShareController {
  private snapshot: ControllerSnapshot = {
    state: { name: 'Idle' },
    message: null,
  };

  private readonly listeners = new Set<ControllerListener>();

  /**
   * The state to return to when the picker is closed without a selection. It is
   * captured at the moment a share action is initiated so cancellation can
   * restore the selection that existed beforehand (Req 2.3).
   */
  private priorState: ShareState = { name: 'Idle' };

  constructor(private readonly deps: MediaShareControllerDeps) {}

  // ---- Subscription API (consumed by the UI in task 9.1) ----

  /**
   * Returns the current snapshot (state + message).
   */
  getSnapshot(): ControllerSnapshot {
    return this.snapshot;
  }

  /**
   * Convenience accessor for the current state only.
   */
  getState(): ShareState {
    return this.snapshot.state;
  }

  /**
   * Subscribe to snapshot changes. The listener is invoked immediately with the
   * current snapshot and on every subsequent change. Returns an unsubscribe
   * function.
   */
  subscribe(listener: ControllerListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(
    state: ShareState,
    message: ControllerMessage | null = null,
  ): void {
    this.snapshot = { state, message };
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }

  private isInFlight(): boolean {
    const name = this.snapshot.state.name;
    return (
      name === 'RequestingPermission' ||
      name === 'PickerOpen' ||
      name === 'Validating' ||
      name === 'Sharing'
    );
  }

  // ---- Flow entry points ----

  /**
   * Begin a share action: request permission if needed and, when granted, open
   * the picker (Req 1.2). Non-granted outcomes surface the matching message and
   * move to the corresponding permission state without opening the picker.
   *
   * No-ops while an operation is already in flight so the flow stays
   * deterministic.
   */
  async initiate(): Promise<void> {
    if (this.isInFlight()) {
      return;
    }

    // Remember what to restore if the picker is later cancelled (Req 2.3).
    this.priorState = this.snapshot.state;

    this.update({ name: 'RequestingPermission' });

    const status = await this.deps.permissionGate.ensurePermission();
    const outcome = this.deps.permissionGate.resolvePermissionOutcome(status);

    if (outcome.action === 'open_picker') {
      await this.openPicker();
      return;
    }

    // A non-granted outcome: surface the message and never open the picker.
    switch (outcome.kind) {
      case 'access_required':
        this.update(
          { name: 'PermissionDenied' },
          { kind: 'access_required', text: ACCESS_REQUIRED_MESSAGE },
        );
        return;
      case 'open_settings':
        this.update(
          { name: 'PermissionBlocked' },
          { kind: 'open_settings', text: OPEN_SETTINGS_MESSAGE },
        );
        return;
      case 'unavailable':
        this.update(
          { name: 'PermissionError' },
          {
            kind: 'permission_unavailable',
            text: PERMISSION_UNAVAILABLE_MESSAGE,
          },
        );
        return;
    }
  }

  /**
   * Open the picker and route its result. On cancel, restore the prior state
   * with the selection unchanged (Req 2.3). On oversize or empty, remain in
   * `PickerOpen` and surface the matching error (Req 2.5, 2.6). On a selection,
   * proceed to validation.
   */
  private async openPicker(): Promise<void> {
    this.update({ name: 'PickerOpen' });

    const result = await this.deps.picker.open();

    switch (result.kind) {
      case 'selected':
        await this.handleSelected(result.item);
        return;

      case 'cancelled':
        // Return to the previous state with the current selection unchanged.
        this.update(this.priorState);
        return;

      case 'rejected_oversize':
        // Stay in the picker and surface the over-size error (Req 2.5).
        this.update(
          { name: 'PickerOpen' },
          { kind: 'oversize', text: OVERSIZE_MESSAGE },
        );
        return;

      case 'empty':
        // Stay in the picker and surface the empty-state (Req 2.6).
        this.update(
          { name: 'PickerOpen' },
          { kind: 'empty', text: EMPTY_LIBRARY_MESSAGE },
        );
        return;
    }
  }

  /**
   * Validate a picked item and, when ready, build its preview and move to
   * `Ready` (Req 2.2, 4.5). When not ready, surface the validation message and
   * return to `Idle` without marking anything ready (Req 3.2, 3.3, 3.6).
   */
  private async handleSelected(item: MediaItem): Promise<void> {
    this.update({ name: 'Validating', item });

    const result = this.deps.validator.validateMediaItem(item);

    if (!result.ready) {
      // Not ready: surface the reason and return to the pre-selection state.
      this.update(
        { name: 'Idle' },
        { kind: result.reason, text: result.message },
      );
      return;
    }

    // Ready: build the preview (which degrades to a placeholder on failure) and
    // move to Ready with the item retained.
    const preview = await this.deps.previewBuilder.build(item);

    const message: ControllerMessage | null =
      preview.kind === 'unavailable'
        ? { kind: 'preview_unavailable', text: PREVIEW_UNAVAILABLE_MESSAGE }
        : null;

    this.update({ name: 'Ready', item, preview }, message);
  }

  /**
   * Start the share action from `Ready`. When the item is not share-eligible,
   * stay in `Ready` and surface the reason (Req 5.5). Otherwise open the share
   * sheet; on dismiss or failure return to `Ready` with the item retained
   * (Req 5.3, 5.4), surfacing an "unavailable" message on failure.
   *
   * No-ops when not currently in `Ready`.
   */
  async share(): Promise<void> {
    const current = this.snapshot.state;
    if (current.name !== 'Ready') {
      return;
    }

    const { item, preview } = current;

    // Share-eligibility gate: do not open the sheet for ineligible items.
    if (!this.deps.validator.canShare(item)) {
      const validation = this.deps.validator.validateMediaItem(item);
      const text = validation.ready ? SHARE_UNAVAILABLE_MESSAGE : validation.message;
      this.update({ name: 'Ready', item, preview }, { kind: 'cannot_share', text });
      return;
    }

    this.update({ name: 'Sharing', item });

    const result = await this.deps.sharePresenter.present(item);

    // In every terminal case the item is retained; only a failure surfaces a
    // message (Req 5.3, 5.4).
    const message: ControllerMessage | null =
      result === 'failed'
        ? { kind: 'share_unavailable', text: SHARE_UNAVAILABLE_MESSAGE }
        : null;

    this.update({ name: 'Ready', item, preview }, message);
  }
}

// ---- Default wiring ----

/**
 * The default collaborators wired to the concrete feature adapters.
 */
export const defaultMediaShareDeps: MediaShareControllerDeps = {
  permissionGate: {
    ensurePermission: defaultEnsurePermission,
    resolvePermissionOutcome: defaultResolvePermissionOutcome,
  },
  picker: { open: defaultPickerOpen },
  validator: {
    validateMediaItem: defaultValidateMediaItem,
    canShare: defaultCanShare,
  },
  previewBuilder: {
    build: defaultBuildPreview,
    truncateFileName: defaultTruncateFileName,
  },
  sharePresenter: { present: defaultPresent },
};

/**
 * Factory that builds a controller with the concrete adapters by default, while
 * allowing any collaborator to be overridden (e.g. for tests).
 */
export function createMediaShareController(
  overrides: Partial<MediaShareControllerDeps> = {},
): MediaShareController {
  return new MediaShareController({ ...defaultMediaShareDeps, ...overrides });
}
