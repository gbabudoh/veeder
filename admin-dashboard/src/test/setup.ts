// Vitest global test setup for the admin dashboard.
//
// Registers jest-dom's custom matchers (e.g. toBeInTheDocument, toHaveTextContent)
// with Vitest's `expect`, and cleans up the rendered DOM between tests so React
// Testing Library renders do not leak state across test cases.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
