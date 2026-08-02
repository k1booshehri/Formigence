import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { PublicQuestionnaire } from '@/api/schemas';

export function usePublicQuestionnaire(
  slug: string | undefined,
): UseQueryResult<PublicQuestionnaire> {
  return useQuery({
    queryKey: ['public-questionnaire', slug],
    queryFn: () => api.getPublicQuestionnaire(slug as string),
    enabled: Boolean(slug),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      // An unknown or unpublished slug will not start working on a retry.
      if (error instanceof ApiError && error.isNotFound) return false;
      return failureCount < 2;
    },
  });
}
