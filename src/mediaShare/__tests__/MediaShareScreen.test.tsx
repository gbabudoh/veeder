/**
 * Simple Media Share - MediaShareScreen example & snapshot tests (task 9.2).
 *
 * These tests drive {@link MediaShareScreen} with a lightweight fake controller
 * that returns a fixed {@link ControllerSnapshot}. Because the real screen
 * seeds its state synchronously from `subscribe(listener)` (the listener is
 * invoked immediately), each render reflects the snapshot we supply.
 *
 * Coverage:
 * - Preview area snapshots in image, video, and unavailable-placeholder states.
 * - The truncated file-name label renders the (already truncated) displayName.
 * - Each error-banner message string renders for its corresponding state.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { MediaShareScreen, TEST_IDS } from '../MediaShareScreen';
import {
  ACCESS_REQUIRED_MESSAGE,
  OVERSIZE_MESSAGE,
  SHARE_UNAVAILABLE_MESSAGE,
  type ControllerMessage,
  type ControllerSnapshot,
  type MediaShareController,
} from '../MediaShareController';
import {
  EXCEEDS_SIZE_MESSAGE,
  UNSUPPORTED_TYPE_MESSAGE,
} from '../MediaValidator';
import type { PreviewModel, ShareState } from '../types';

/**
 * Build a fake controller that exposes only the surface the screen consumes.
 * `subscribe` invokes the listener immediately with the fixed snapshot (as the
 * real controller does) and returns a noop unsubscribe. The imperative methods
 * are inert no-ops; these tests only assert rendered output for a given state.
 */
function fakeController(
  state: ShareState,
  message: ControllerMessage | null = null,
): MediaShareController {
  const snapshot: ControllerSnapshot = { state, message };
  const fake = {
    getSnapshot: () => snapshot,
    getState: () => snapshot.state,
    subscribe: (listener: (s: ControllerSnapshot) => void) => {
      listener(snapshot);
      return () => {};
    },
    initiate: async () => {},
    share: async () => {},
  };
  return fake as unknown as MediaShareController;
}

/** Render the screen wrapped in act() so the subscribe/useEffect settles. */
function renderScreen(
  state: ShareState,
  message: ControllerMessage | null = null,
): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <MediaShareScreen controller={fakeController(state, message)} />,
    );
  });
  return renderer;
}

/**
 * Count of host elements carrying a given testID. `findAllByProps` matches both
 * the composite React element and the underlying host node, so we keep only the
 * host instances (whose `type` is a string) to get a stable element count.
 */
function countByTestId(renderer: ReactTestRenderer, testID: string): number {
  return renderer.root
    .findAllByProps({ testID })
    .filter(node => typeof node.type === 'string').length;
}

describe('MediaShareScreen - preview area', () => {
  it('Ready + image preview renders the preview image, filename label, and share button', () => {
    const preview: PreviewModel = {
      kind: 'image',
      uri: 'file:///photo.jpg',
      displayName: 'photo.jpg',
    };
    const state: ShareState = {
      name: 'Ready',
      item: {
        uri: preview.uri,
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        fileName: 'photo.jpg',
      },
      preview,
    };

    const renderer = renderScreen(state);

    // Preview image present (Req 4.1).
    expect(countByTestId(renderer, TEST_IDS.previewImage)).toBe(1);
    // No play indicator or placeholder for an image.
    expect(countByTestId(renderer, TEST_IDS.playIndicator)).toBe(0);
    expect(countByTestId(renderer, TEST_IDS.placeholder)).toBe(0);
    // Share control present when ready (Req 4.5).
    expect(countByTestId(renderer, TEST_IDS.shareButton)).toBe(1);

    // Filename label shows the preview displayName (Req 4.4).
    const label = renderer.root.findByProps({ testID: TEST_IDS.fileNameLabel });
    expect(label.props.children).toBe('photo.jpg');

    expect(renderer.toJSON()).toMatchSnapshot();
  });

  it('Ready + video preview renders the frame image AND the play indicator', () => {
    const preview: PreviewModel = {
      kind: 'video',
      frameUri: 'file:///clip-frame.jpg',
      displayName: 'clip.mp4',
      showPlayIndicator: true,
    };
    const state: ShareState = {
      name: 'Ready',
      item: {
        uri: 'file:///clip.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 2048,
        fileName: 'clip.mp4',
      },
      preview,
    };

    const renderer = renderScreen(state);

    // Video preview shows the first-frame image plus a play indicator (Req 4.2).
    expect(countByTestId(renderer, TEST_IDS.previewImage)).toBe(1);
    expect(countByTestId(renderer, TEST_IDS.playIndicator)).toBe(1);
    expect(countByTestId(renderer, TEST_IDS.placeholder)).toBe(0);

    expect(renderer.toJSON()).toMatchSnapshot();
  });

  it('Ready + unavailable preview renders the placeholder and no image', () => {
    const preview: PreviewModel = {
      kind: 'unavailable',
      displayName: 'mystery.mov',
    };
    const state: ShareState = {
      name: 'Ready',
      item: {
        uri: 'file:///mystery.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 4096,
        fileName: 'mystery.mov',
      },
      preview,
    };

    const renderer = renderScreen(state);

    // Placeholder shown, no image, share still enabled (Req 4.3).
    expect(countByTestId(renderer, TEST_IDS.placeholder)).toBe(1);
    expect(countByTestId(renderer, TEST_IDS.previewImage)).toBe(0);
    expect(countByTestId(renderer, TEST_IDS.playIndicator)).toBe(0);
    expect(countByTestId(renderer, TEST_IDS.shareButton)).toBe(1);

    expect(renderer.toJSON()).toMatchSnapshot();
  });

  it('renders an already-truncated file name verbatim in the label (Req 4.4)', () => {
    // A displayName that has already been truncated with the ellipsis indicator.
    const truncated = 'a-really-long-media-file-name-that-goes\u2026';
    const preview: PreviewModel = {
      kind: 'image',
      uri: 'file:///long.jpg',
      displayName: truncated,
    };
    const state: ShareState = {
      name: 'Ready',
      item: {
        uri: 'file:///long.jpg',
        mimeType: 'image/png',
        sizeBytes: 512,
        fileName: 'long.jpg',
      },
      preview,
    };

    const renderer = renderScreen(state);

    const label = renderer.root.findByProps({ testID: TEST_IDS.fileNameLabel });
    expect(label.props.children).toBe(truncated);
  });
});

describe('MediaShareScreen - error-banner messages', () => {
  // Each entry pairs a state + message with the exact text expected in the banner.
  const cases: Array<{
    label: string;
    state: ShareState;
    message: ControllerMessage;
  }> = [
    {
      label: 'access_required',
      state: { name: 'PermissionDenied' },
      message: { kind: 'access_required', text: ACCESS_REQUIRED_MESSAGE },
    },
    {
      label: 'oversize',
      state: { name: 'PickerOpen' },
      message: { kind: 'oversize', text: OVERSIZE_MESSAGE },
    },
    {
      label: 'unsupported_type',
      state: { name: 'Idle' },
      message: { kind: 'unsupported_type', text: UNSUPPORTED_TYPE_MESSAGE },
    },
    {
      label: 'exceeds_size',
      state: { name: 'Idle' },
      message: { kind: 'exceeds_size', text: EXCEEDS_SIZE_MESSAGE },
    },
    {
      label: 'share_unavailable',
      state: {
        name: 'Ready',
        item: {
          uri: 'file:///a.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1,
          fileName: 'a.jpg',
        },
        preview: { kind: 'image', uri: 'file:///a.jpg', displayName: 'a.jpg' },
      },
      message: { kind: 'share_unavailable', text: SHARE_UNAVAILABLE_MESSAGE },
    },
    {
      label: 'cannot_share',
      state: {
        name: 'Ready',
        item: {
          uri: 'file:///big.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 999,
          fileName: 'big.mp4',
        },
        preview: {
          kind: 'video',
          frameUri: 'file:///big-frame.jpg',
          displayName: 'big.mp4',
          showPlayIndicator: true,
        },
      },
      message: { kind: 'cannot_share', text: EXCEEDS_SIZE_MESSAGE },
    },
  ];

  it.each(cases)(
    'renders the exact banner text for the $label state',
    ({ state, message }) => {
      const renderer = renderScreen(state, message);

      const banner = renderer.root.findByProps({
        testID: TEST_IDS.messageBanner,
      });
      // The banner exposes the message text via accessibilityLabel...
      expect(banner.props.accessibilityLabel).toBe(message.text);

      // ...and renders it as the banner's text content.
      const textNode = banner.findByProps({ children: message.text });
      expect(textNode).toBeTruthy();

      expect(renderer.toJSON()).toMatchSnapshot();
    },
  );
});
