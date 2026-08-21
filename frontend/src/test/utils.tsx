/** Shared test helpers: a fresh QueryClient per test. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';

/**
 * Retries and caching would make assertions non-deterministic.
 *
 * `retryDelay: 0` matters for the hooks that set their own `retry` policy: that
 * overrides `retry: false` here, and the default backoff would then push the
 * error state past a test's wait.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0, staleTime: 0 },
      mutations: { retry: false, retryDelay: 0 },
    },
  });
}

export function withQueryClient(ui: ReactNode, client = createTestQueryClient()): ReactElement {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}
