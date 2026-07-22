import { QueryClient } from '@tanstack/react-query';

/**
 * Builds a fresh {@link QueryClient} tuned for tests.
 *
 * Retries are disabled for both queries and mutations so that failing requests
 * surface immediately (rather than being retried with backoff, which slows tests
 * and hides the error path under test). Each test should create its own client
 * via this helper to keep query caches isolated between tests.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
