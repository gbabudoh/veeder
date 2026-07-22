// Feature: simple-media-share, Property 7: Readiness transition matches validation result

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
  ValidationResult,
} from '../types';

/**
 * Property 7 (Validates: Requirements 2.2, 3.6, 4.5)
 *
 * For any result returned from the picker, the controller transitions to a
 * state that marks the item ready to share if and only if an item was returned
 * (kind 'selected') AND validateMediaItem reports it ready. When no item is
 * returned, or the item is not ready, no item is marked ready and the
 * controller returns to its pre-selection (Idle) state.
 *
 * Permission is granted (ensurePermission -> 'granted') and the real
 * resolvePermissionOutcome maps 'granted' -> open_picker so the flow always
 * reaches the picker. previewBuilder.build resolves to an image preview and
 * truncateFileName is a simple passthrough so a ready item reaches 'Ready'.
 */

// A valid image MediaItem the picker can return.
const mediaItemArb: fc.Arbitrary<MediaItem> = fc.record({
  uri: fc.webUrl(),
  mimeType: fc.constant('image/jpeg'),
  sizeBytes: fc.integer({ min: 0, max: 100 * 1024 * 1024 }),
  fileName: fc.string(),
});

// Build a controller whose collaborators are configured for this run.
function buildController(
  item: MediaItem,
  shouldBeReady: boolean,
): ReturnType<typeof createMediaShareController> {
  const validation: ValidationResult = shouldBeReady
    ? { ready: true }
    : {
        ready: false,
        reason: 'unsupported_type',
        message: 'x',
      };

  const preview: PreviewModel = {
    kind: 'image',
    uri: item.uri,
    displayName: item.fileName,
  };

  const overrides: Partial<MediaShareControllerDeps> = {
    permissionGate: {
      ensurePermission: async () => 'granted',
      resolvePermissionOutcome,
    },
    picker: {
      open: async (): Promise<PickResult> => ({ kind: 'selected', item }),
    },
    validator: {
      validateMediaItem: () => validation,
      canShare: () => shouldBeReady,
    },
    previewBuilder: {
      build: async () => preview,
      truncateFileName: (name: string) => ({ text: name, truncated: false }),
    },
  };

  return createMediaShareController(overrides);
}

describe('MediaShareController - Property 7: readiness transition matches validation result', () => {
  it('ends in Ready with the item iff selected AND validation ready; otherwise returns to Idle', async () => {
    await fc.assert(
      fc.asyncProperty(
        mediaItemArb,
        fc.boolean(),
        async (item, shouldBeReady) => {
          const controller = buildController(item, shouldBeReady);

          await controller.initiate();

          const state = controller.getState();

          if (shouldBeReady) {
            // Item returned and validation ready -> marked ready to share.
            expect(state.name).toBe('Ready');
            if (state.name === 'Ready') {
              expect(state.item).toEqual(item);
              expect(state.preview.kind).toBe('image');
            }
          } else {
            // Selected but not ready -> nothing marked ready; back to Idle.
            expect(state.name).toBe('Idle');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a cancelled pick returns to the prior (Idle) state and never marks ready', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const controller = createMediaShareController({
          permissionGate: {
            ensurePermission: async () => 'granted',
            resolvePermissionOutcome,
          },
          picker: {
            open: async (): Promise<PickResult> => ({ kind: 'cancelled' }),
          },
        });

        await controller.initiate();

        // Cancellation returns to the prior state (Idle at start), not Ready.
        expect(controller.getState().name).toBe('Idle');
      }),
      { numRuns: 100 },
    );
  });
});
