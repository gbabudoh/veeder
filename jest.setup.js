/**
 * Jest setup: mock the native media-share modules so tests run device-free.
 *
 * These modules register native (Turbo) modules that don't exist in the Jest
 * environment, so we replace them with lightweight mocks. Behavioural tests for
 * the feature inject their own adapter mocks; these defaults just keep imports
 * (e.g. from App.tsx) from touching the native binary.
 */

// react-native-permissions ships an official mock implementation.
jest.mock('react-native-permissions', () =>
  require('react-native-permissions/mock'),
);

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(() =>
    Promise.resolve({ didCancel: true, assets: [] }),
  ),
  launchCamera: jest.fn(() =>
    Promise.resolve({ didCancel: true, assets: [] }),
  ),
}));

jest.mock('react-native-share', () => ({
  __esModule: true,
  default: {
    open: jest.fn(() => Promise.resolve({ success: true })),
    single: jest.fn(() => Promise.resolve({ success: true })),
  },
}));
