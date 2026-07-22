module.exports = {
  preset: '@react-native/jest-preset',
  // The media-share feature depends on native modules that ship untranspiled
  // ESM/TypeScript. Whitelist them so Jest transforms them with the RN babel
  // preset instead of trying to run them as plain CommonJS.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-image-picker|react-native-permissions|react-native-share|react-native-safe-area-context)/)',
  ],
  // Mock the native media-share modules so imports stay device-free.
  setupFiles: ['<rootDir>/jest.setup.js'],
};
