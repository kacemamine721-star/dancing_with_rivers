import { QueryClient } from '@tanstack/react-query';

import { shouldRetry } from '@/data/hooks';

/** One client per app: the bundle is static and versioned, so data never goes stale. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: false, staleTime: Infinity },
    },
  });
}
