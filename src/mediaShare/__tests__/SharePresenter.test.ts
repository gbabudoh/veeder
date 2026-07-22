// Feature: simple-media-share
// Unit tests for SharePresenter.present result mapping (Task 6.2)
// Validates: Requirements 5.3, 5.4

/**
 * These example-based unit tests verify how `SharePresenter.present` maps the
 * outcomes of `react-native-share`'s `Share.open` onto the feature's
 * `ShareResult` contract:
 *
 * - a normal resolve                         -> 'shared'  (Req 5.1/5.2)
 * - a resolve with `dismissedAction: true`   -> 'dismissed' (Req 5.3)
 * - a reject whose message indicates a
 *   user dismissal/cancellation              -> 'dismissed' (Req 5.3)
 * - any other reject / non-dismissal error   -> 'failed'  (Req 5.4)
 *
 * `react-native-share` is mocked globally in `jest.setup.js`; here we
 * reconfigure its default `open` mock per test via `mockResolvedValueOnce` /
 * `mockRejectedValueOnce`.
 */

// Re-mock react-native-share locally so its default export exposes an `open`
// jest.fn we can configure per test. This matches how SharePresenter imports it
// (`import Share from 'react-native-share'`).
jest.mock('react-native-share', () => ({
  __esModule: true,
  default: {
    open: jest.fn(),
  },
}));

import Share from 'react-native-share';

import {present} from '../SharePresenter';
import type {MediaItem} from '../types';

const openMock = Share.open as jest.Mock;

// A representative, share-eligible sample item.
const sampleItem: MediaItem = {
  uri: 'file:///tmp/photo.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1024,
  fileName: 'photo.jpg',
};

describe('SharePresenter.present - share result mapping', () => {
  beforeEach(() => {
    openMock.mockReset();
  });

  it("maps a normal resolve to 'shared'", async () => {
    openMock.mockResolvedValueOnce({success: true});

    await expect(present(sampleItem)).resolves.toBe('shared');

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock).toHaveBeenCalledWith({
      url: sampleItem.uri,
      type: sampleItem.mimeType,
      filename: sampleItem.fileName,
    });
  });

  it("maps a resolve with dismissedAction: true to 'dismissed'", async () => {
    openMock.mockResolvedValueOnce({success: false, dismissedAction: true});

    await expect(present(sampleItem)).resolves.toBe('dismissed');
  });

  it("maps a reject 'User did not share' to 'dismissed'", async () => {
    openMock.mockRejectedValueOnce(new Error('User did not share'));

    await expect(present(sampleItem)).resolves.toBe('dismissed');
  });

  it("maps a reject 'User cancelled' to 'dismissed'", async () => {
    openMock.mockRejectedValueOnce(new Error('User cancelled'));

    await expect(present(sampleItem)).resolves.toBe('dismissed');
  });

  it("maps a reject with a non-dismissal error to 'failed'", async () => {
    openMock.mockRejectedValueOnce(new Error('Network failure'));

    await expect(present(sampleItem)).resolves.toBe('failed');
  });

  it("maps a reject with a generic 'Something went wrong' error to 'failed'", async () => {
    openMock.mockRejectedValueOnce(new Error('Something went wrong'));

    await expect(present(sampleItem)).resolves.toBe('failed');
  });

  it("maps a reject of a non-Error value without a message to 'failed'", async () => {
    // A rejected string that contains no dismissal marker.
    openMock.mockRejectedValueOnce('unexpected');

    await expect(present(sampleItem)).resolves.toBe('failed');

    // An object with no `message` field also maps to 'failed'.
    openMock.mockRejectedValueOnce({code: 500});

    await expect(present(sampleItem)).resolves.toBe('failed');
  });
});
