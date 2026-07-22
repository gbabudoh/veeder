/**
 * Simple Media Share - MediaShareScreen.
 *
 * The entry-point UI for the media-share flow. It is a thin, presentational
 * shell bound to a {@link MediaShareController}: it renders the share trigger,
 * the preview area, the (already truncated) file-name label, the share control,
 * and an inline message/error banner. All decision-making lives in the
 * controller; this screen only reflects the controller's snapshot and forwards
 * user intent (`initiate`, `share`) back to it.
 *
 * The `controller` prop is optional so the screen can be driven by a mock
 * controller in tests (task 9.2). When omitted, a controller wired to the
 * concrete adapters is created for the lifetime of the component.
 *
 * Requirements: 1.3, 1.5, 1.6, 2.6, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.4, 5.5
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  createMediaShareController,
  type ControllerSnapshot,
  type MediaShareController,
} from './MediaShareController';
import type { PreviewModel } from './types';

/**
 * Props for {@link MediaShareScreen}.
 */
export interface MediaShareScreenProps {
  /**
   * The controller that owns the flow. Optional: when not supplied, a
   * controller wired to the concrete adapters is created for the component's
   * lifetime. Tests supply a mock controller to drive specific states.
   */
  controller?: MediaShareController;
}

// testIDs are exported so tests can query key elements without duplicating
// string literals.
export const TEST_IDS = {
  shareTrigger: 'media-share-trigger',
  shareButton: 'media-share-button',
  previewImage: 'media-share-preview-image',
  playIndicator: 'media-share-play-indicator',
  placeholder: 'media-share-placeholder',
  fileNameLabel: 'media-share-filename',
  messageBanner: 'media-share-message',
} as const;

/**
 * The media-share screen bound to a controller snapshot.
 */
export function MediaShareScreen({
  controller: providedController,
}: MediaShareScreenProps) {
  // Use the supplied controller, or create one for this component's lifetime.
  const controller = useMemo(
    () => providedController ?? createMediaShareController(),
    [providedController],
  );

  // Mirror the controller's snapshot in local state. `subscribe` invokes the
  // listener immediately, so the initial state is seeded synchronously.
  const [snapshot, setSnapshot] = useState<ControllerSnapshot>(() =>
    controller.getSnapshot(),
  );

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    return unsubscribe;
  }, [controller]);

  const { state, message } = snapshot;
  const isReady = state.name === 'Ready';

  return (
    <View style={styles.container}>
      {/* Share trigger: begins the flow (permission -> picker). (Req 1.2 entry) */}
      <TouchableOpacity
        testID={TEST_IDS.shareTrigger}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel="Share media"
        onPress={() => {
          void controller.initiate();
        }}
      >
        <Text style={styles.triggerText}>Share media</Text>
      </TouchableOpacity>

      {/* Preview area: only present once an item is Ready. */}
      {isReady ? (
        <View style={styles.previewArea}>
          <PreviewContent preview={state.preview} />

          {/* Truncated file-name label. The controller/preview already
              provides a truncated displayName; render it as-is. (Req 4.4) */}
          <Text
            testID={TEST_IDS.fileNameLabel}
            style={styles.fileName}
            numberOfLines={1}
            accessibilityLabel={state.preview.displayName}
          >
            {state.preview.displayName}
          </Text>

          {/* Share control: starts the share action. (Req 4.5, 5.x) */}
          <TouchableOpacity
            testID={TEST_IDS.shareButton}
            style={styles.shareButton}
            accessibilityRole="button"
            accessibilityLabel="Share this item"
            onPress={() => {
              void controller.share();
            }}
          >
            <Text style={styles.shareButtonText}>Share</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Inline message/error banner for permission, validation, preview, and
          share outcomes. (Req 1.3, 1.5, 1.6, 2.6, 3.2, 3.3, 4.3, 5.4, 5.5) */}
      {message ? (
        <View
          testID={TEST_IDS.messageBanner}
          style={styles.banner}
          accessibilityRole="alert"
          accessibilityLabel={message.text}
        >
          <Text style={styles.bannerText}>{message.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Renders the preview visual for a Ready item by preview kind:
 * - image     -> thumbnail (Req 4.1)
 * - video     -> first-frame thumbnail overlaid with a play indicator (Req 4.2)
 * - unavailable -> a placeholder indicating the preview is unavailable (Req 4.3)
 */
function PreviewContent({ preview }: { preview: PreviewModel }) {
  switch (preview.kind) {
    case 'image':
      return (
        <Image
          testID={TEST_IDS.previewImage}
          style={styles.previewImage}
          resizeMode="cover"
          source={{ uri: preview.uri }}
          accessibilityRole="image"
          accessibilityLabel="Selected image preview"
        />
      );

    case 'video':
      return (
        <View style={styles.videoPreview}>
          <Image
            testID={TEST_IDS.previewImage}
            style={styles.previewImage}
            resizeMode="cover"
            source={{ uri: preview.frameUri }}
            accessibilityRole="image"
            accessibilityLabel="Selected video preview frame"
          />
          {/* Play indicator overlay. */}
          <View
            testID={TEST_IDS.playIndicator}
            style={styles.playIndicator}
            accessibilityRole="image"
            accessibilityLabel="Video"
            pointerEvents="none"
          >
            <Text style={styles.playIndicatorGlyph}>{'\u25B6'}</Text>
          </View>
        </View>
      );

    case 'unavailable':
    default:
      return (
        <View
          testID={TEST_IDS.placeholder}
          style={styles.placeholder}
          accessibilityRole="image"
          accessibilityLabel="Preview unavailable"
        >
          <Text style={styles.placeholderText}>Preview unavailable</Text>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  trigger: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  triggerText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  previewArea: {
    gap: 12,
    alignItems: 'stretch',
  },
  previewImage: {
    width: '100%',
    height: 240,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
  },
  videoPreview: {
    width: '100%',
    height: 240,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIndicator: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIndicatorGlyph: {
    color: '#ffffff',
    fontSize: 28,
    marginLeft: 4,
  },
  placeholder: {
    width: '100%',
    height: 240,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#6b7280',
    fontSize: 14,
  },
  fileName: {
    fontSize: 14,
    color: '#111827',
  },
  shareButton: {
    backgroundColor: '#16a34a',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  shareButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  banner: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  bannerText: {
    color: '#991b1b',
    fontSize: 14,
  },
});

export default MediaShareScreen;
