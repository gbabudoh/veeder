// Feature: simple-media-share, Property 5: Oversize selection is rejected while the picker state is retained

import fc from 'fast-check';

import { MAX_FILE_SIZE_BYTES } from '../constants';
import {
  createMediaShareController,
  type MediaShareControllerDeps,
} from '../MediaShareController';
import { resolvePermissionOutcome } from '../PermissionManager';
import type { MediaItem, PickResult } from '../types';

/**
 * Property 5 (Validates: Requirements 2.5)
 *
 * For any picked item whose size exceeds `MAX_FILE_SIZE_BYTES`, when the picker
 * returns `{ kind: 'rejected_oversize', item }`, after `controller.initiate()`:
 *   - the controller state remains `PickerOpen`,
 *   - no item is marked ready to share (state is not `Ready`),
 *   - an over-size error message is surfaced (`message.kind === 'oversize'`).
 *
 * The adapters are mocked so the run is deterministic and device-free:
 *   - `permissionGate.ensurePermission` resolves `granted` so the flow reaches
 *     the picker, while the real `resolvePermissionOutcome` keeps the decision
 *     table honest.
 *   - `picker.open` resolves the oversize rejection carrying the generated item.
 * The remaining collaborators are stubbed and should never be reached.
 */

// Generate a MediaItem whose size is strictly above the limit.
const oversizeItemArb: fc.Arbitrary<MediaItem> = fc.record({
  uri: fc.string(),
  mimeType: fc.string(),
  sizeBytes: fc.integer({
    min: MAX_FILE_SIZE_BYTES + 1,
    max: MAX_FILE_SIZE_BYTES * 4,
  }),
  fileName: fc.string(),
});

describe('MediaShareController - Property 5: oversize rejected, picker retained', () => {
  it('remains in PickerOpen, marks nothing ready, and surfaces an oversize error', async () => {
    await fc.assert(
      fc.asyncProperty(oversizeItemArb, async item => {
        const rejected: PickResult = { kind: 'rejected_oversize', item };

        // Stubs for collaborators that must not influence this path.
        const validateMediaItem = jest.fn();
        const canShare = jest.fn();
        const build = jest.fn();
        const present = jest.fn();

        const overrides: Partial<MediaShareControllerDeps> = {
          permissionGate: {
            // Reach the picker by resolving a granted status...
            ensurePermission: jest.fn().mockResolvedValue('granted'),
            // ...using the real decision table (granted -> open_picker).
            resolvePermissionOutcome,
          },
          picker: {
            open: jest.fn().mockResolvedValue(rejected),
          },
          validator: {
            validateMediaItem,
            canShare,
          },
          previewBuilder: {
            build,
            truncateFileName: (name: string) => ({
              text: name,
              truncated: false,
            }),
          },
          sharePresenter: {
            present,
          },
        };

        const controller = createMediaShareController(overrides);

        await controller.initiate();

        const snapshot = controller.getSnapshot();

        // Remains in the picker-open state (Req 2.5).
        expect(snapshot.state.name).toBe('PickerOpen');

        // No item is marked ready to share.
        expect(snapshot.state.name).not.toBe('Ready');

        // An over-size error message is surfaced.
        expect(snapshot.message).not.toBeNull();
        expect(snapshot.message?.kind).toBe('oversize');

        // The oversize item never advances to validation, preview, or share.
        expect(validateMediaItem).not.toHaveBeenCalled();
        expect(build).not.toHaveBeenCalled();
        expect(present).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});
