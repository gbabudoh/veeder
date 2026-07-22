/**
 * Jest configuration for veeder-server.
 *
 * Uses the ts-jest preset so TypeScript test files run directly against the
 * project's tsconfig (strict mode). Tests live under `src/` next to the code
 * they validate. A single setup file bootstraps the test environment and
 * configures fast-check's global run count.
 *
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Discover tests under the source tree only.
  roots: ['<rootDir>/src'],
  // Match both `*.test.ts` and `*.spec.ts` naming conventions.
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  // Bootstrap the test env and fast-check global settings before each suite.
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  clearMocks: true,
  // ts-jest reads the project's tsconfig.json for compiler options.
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
};
