/**
 * Simple Media Share - MediaPicker result classification unit tests (task 5.2).
 *
 * Mocks `react-native-image-picker`'s `launchImageLibrary` so it returns
 * configurable `ImagePickerResponse` objects, then asserts that `open`
 * normalizes the native asset and classifies the outcome into the correct
 * `PickResult`:
 *   - didCancel                          -> 'cancelled'
 *   - no usable asset (missing/empty/    -> 'empty'
 *     no uri)
 *   - valid asset within the size limit  -> 'selected' (normalized MediaItem)
 *   - asset over MAX_FILE_SIZE_BYTES     -> 'rejected_oversize' (normalized item)
 *
 * Validates: Requirements 2.3, 2.5, 2.6
 */

import type { ImagePickerResponse } from 'react-native-image-picker';

// Manual, fully-controllable mock of react-native-image-picker so the test is
// device-free and the native call is a configurable spy.
const mockLaunchImageLibrary = jest.fn();

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: (...args: unknown[]) => mockLaunchImageLibrary(...args),
}));

// Import after the mock is registered.
import { MAX_FILE_SIZE_BYTES } from '../constants';
import { open } from '../MediaPicker';

/** Configure the mocked picker to resolve with the given native response. */
function whenPickerReturns(response: ImagePickerResponse): void {
  mockLaunchImageLibrary.mockResolvedValue(response);
}

describe('MediaPicker.open result classification', () => {
  beforeEach(() => {
    // Reset the mock between tests so call state does not leak across cases.
    mockLaunchImageLibrary.mockReset();
  });

  it('classifies a cancelled picker response as cancelled (Requirement 2.3)', async () => {
    whenPickerReturns({ didCancel: true });

    await expect(open()).resolves.toEqual({ kind: 'cancelled' });
  });

  it('classifies a response with an empty assets array as empty (Requirement 2.6)', async () => {
    whenPickerReturns({ assets: [] });

    await expect(open()).resolves.toEqual({ kind: 'empty' });
  });

  it('classifies a response with no assets field as empty (Requirement 2.6)', async () => {
    whenPickerReturns({});

    await expect(open()).resolves.toEqual({ kind: 'empty' });
  });

  it('classifies an asset with no uri as empty (Requirement 2.6)', async () => {
    whenPickerReturns({
      assets: [{ type: 'image/jpeg', fileSize: 1024, fileName: 'no-uri.jpg' }],
    });

    await expect(open()).resolves.toEqual({ kind: 'empty' });
  });

  it('classifies a valid within-limit asset as selected with a normalized MediaItem (Requirement 2.2)', async () => {
    whenPickerReturns({
      assets: [
        {
          uri: 'file:///tmp/photo.jpg',
          type: 'image/jpeg',
          fileSize: 2048,
          fileName: 'photo.jpg',
        },
      ],
    });

    await expect(open()).resolves.toEqual({
      kind: 'selected',
      item: {
        uri: 'file:///tmp/photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 2048,
        fileName: 'photo.jpg',
      },
    });
  });

  it('normalizes missing type/fileSize/fileName fields (fileSize defaults to 0)', async () => {
    whenPickerReturns({
      assets: [{ uri: 'file:///tmp/mystery' }],
    });

    await expect(open()).resolves.toEqual({
      kind: 'selected',
      item: {
        uri: 'file:///tmp/mystery',
        mimeType: '',
        sizeBytes: 0,
        fileName: '',
      },
    });
  });

  it('classifies an asset one byte over the limit as rejected_oversize with a normalized item (Requirement 2.5)', async () => {
    whenPickerReturns({
      assets: [
        {
          uri: 'file:///tmp/huge.mp4',
          type: 'video/mp4',
          fileSize: MAX_FILE_SIZE_BYTES + 1,
          fileName: 'huge.mp4',
        },
      ],
    });

    await expect(open()).resolves.toEqual({
      kind: 'rejected_oversize',
      item: {
        uri: 'file:///tmp/huge.mp4',
        mimeType: 'video/mp4',
        sizeBytes: MAX_FILE_SIZE_BYTES + 1,
        fileName: 'huge.mp4',
      },
    });
  });

  it('classifies an asset exactly at the limit as selected, not oversize (boundary)', async () => {
    whenPickerReturns({
      assets: [
        {
          uri: 'file:///tmp/exact.mp4',
          type: 'video/mp4',
          fileSize: MAX_FILE_SIZE_BYTES,
          fileName: 'exact.mp4',
        },
      ],
    });

    await expect(open()).resolves.toEqual({
      kind: 'selected',
      item: {
        uri: 'file:///tmp/exact.mp4',
        mimeType: 'video/mp4',
        sizeBytes: MAX_FILE_SIZE_BYTES,
        fileName: 'exact.mp4',
      },
    });
  });
});
