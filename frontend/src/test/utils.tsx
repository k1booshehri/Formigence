/** Shared test helpers: a fresh QueryClient per test. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';

/** Retries and caching would make assertions non-deterministic. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function withQueryClient(ui: ReactNode, client = createTestQueryClient()): ReactElement {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}
