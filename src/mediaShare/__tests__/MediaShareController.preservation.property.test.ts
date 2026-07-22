// Feature: simple-media-share, Property 8: Cancellation and post-share return preserve selection state

import fc from 'fast-check';

import {
  createMediaShareController,
  type MediaShareControllerDeps,
} from '../MediaShareController';
import { resolvePermissionOutcome } from '../PermissionManager';
import type {
  MediaItem,
  PickResult,
  PreviewModel,
  ShareResult,
  ValidationResult,
} from '../types';

/**
 * Property 8 (Validates: Requirements 2.3, 5.3, 5.4)
 *
 * Cancellation and post-share return preserve selection state:
 *   1. Picker cancellation preserves the current selection (Req 2.3). Once the
 *      controller is Ready with an item, initiating a second share flow whose
 *      picker returns `cancelled` restores the prior state (Ready) with the
 *      SAME item still selected. The controller captures `priorState` at
 *      `initiate()` and restores it on cancel.
 *   2. Post-share return preserves the selection (Req 5.3, 5.4). From Ready,
 *      calling `share()` where the share sheet resolves to `dismissed` or
 *      `failed` returns to `Ready` with the same item still selected. A
 *      `failed` result additionally surfaces a `share_unavailable` message.
 *
 * The native adapters are mocked so runs stay deterministic and device-free.
 * The real `resolvePermissionOutcome` keeps the permission decision table
 * honest (granted -> open_picker).
 */

// A valid, ready image MediaItem the picker can return.
const mediaItemArb: fc.Arbitrary<MediaItem> = fc.record({
  uri: fc.webUrl(),
  mimeType: fc.constant('image/jpeg'),
  sizeBytes: fc.integer({ min: 0, max: 100 * 1024 * 1024 }),
  fileName: fc.string(),
});

const READY_VALIDATION: ValidationResult = { ready: true };

function imagePreview(item: MediaItem): PreviewModel {
  return { kind: 'image', uri: item.uri, displayName: item.fileName };
}

/**
 * Build a controller whose picker yields `selected` on the first open and
 * `cancelled` on every subsequent open, with a ready validator and an image
 * preview so the first flow reaches `Ready`.
 */
function buildCancellationController(
  item: MediaItem,
): ReturnType<typeof createMediaShareController> {
  let openCount = 0;

  const overrides: Partial<MediaShareControllerDeps> = {
    permissionGate: {
      ensurePermission: async () => 'granted',
      resolvePermissionOutcome,
    },
    picker: {
      open: async (): Promise<PickResult> => {
        openCount += 1;
        return openCount === 1
          ? { kind: 'selected', item }
          : { kind: 'cancelled' };
      },
    },
    validator: {
      validateMediaItem: () => READY_VALIDATION,
      canShare: () => true,
    },
    previewBuilder: {
      build: async () => imagePreview(item),
      truncateFileName: (name: string) => ({ text: name, truncated: false }),
    },
  };

  return createMediaShareController(overrides);
}

/**
 * Build a controller driven to `Ready` whose share presenter resolves to the
 * given result. The picker returns the item once so the first `initiate()`
 * reaches `Ready`.
 */
function buildShareController(
  item: MediaItem,
  shareResult: ShareResult,
): ReturnType<typeof createMediaShareController> {
  const overrides: Partial<MediaShareControllerDeps> = {
    permissionGate: {
      ensurePermission: async () => 'granted',
      resolvePermissionOutcome,
    },
    picker: {
      open: async (): Promise<PickResult> => ({ kind: 'selected', item }),
    },
    validator: {
      validateMediaItem: () => READY_VALIDATION,
      canShare: () => true,
    },
    previewBuilder: {
      build: async () => imagePreview(item),
      truncateFileName: (name: string) => ({ text: name, truncated: false }),
    },
    sharePresenter: {
      present: async () => shareResult,
    },
  };

  return createMediaShareController(overrides);
}

describe('MediaShareController - Property 8: cancellation and post-share preserve selection', () => {
  it('picker cancellation restores the prior Ready state with the same item (Req 2.3)', async () => {
    await fc.assert(
      fc.asyncProperty(mediaItemArb, async item => {
        const controller = buildCancellationController(item);

        // First flow: reach Ready with the selected item.
        await controller.initiate();
        const readyState = controller.getState();
        expect(readyState.name).toBe('Ready');
        if (readyState.name === 'Ready') {
          expect(readyState.item).toEqual(item);
        }

        // Second flow: picker cancels -> restore the prior state (Ready) with
        // the SAME item still selected.
        await controller.initiate();

        const state = controller.getState();
        expect(state.name).toBe('Ready');
        if (state.name === 'Ready') {
          expect(state.item).toEqual(item);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('post-share dismiss/fail returns to Ready with the same item; failure surfaces share_unavailable (Req 5.3, 5.4)', async () => {
    const shareResultArb = fc.constantFrom<ShareResult>('dismissed', 'failed');

    await fc.assert(
      fc.asyncProperty(
        mediaItemArb,
        shareResultArb,
        async (item, shareResult) => {
          const controller = buildShareController(item, shareResult);

          // Drive to Ready.
          await controller.initiate();
          expect(controller.getState().name).toBe('Ready');

          // Attempt to share; dismiss/fail returns to Ready, item retained.
          await controller.share();

          const snapshot = controller.getSnapshot();
          expect(snapshot.state.name).toBe('Ready');
          if (snapshot.state.name === 'Ready') {
            expect(snapshot.state.item).toEqual(item);
          }

          if (shareResult === 'failed') {
            // A failed share surfaces the share-unavailable message (Req 5.4).
            expect(snapshot.message).not.toBeNull();
            expect(snapshot.message?.kind).toBe('share_unavailable');
          } else {
            // A dismissed share retains the item with no failure message (Req 5.3).
            expect(snapshot.message).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
