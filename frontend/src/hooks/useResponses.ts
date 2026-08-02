/** Server state for the owner's view of collected responses. */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '@/api/endpoints';
import type { ResponseDetail, ResponsePage } from '@/api/schemas';

/** Matches the backend's PAGE_SIZE_DEFAULT; PAGE_SIZE_MAX is 100. */
export const RESPONSES_PAGE_SIZE = 20;

export const responseKeys = {
  list: (questionnaireId: string, offset: number) =>
    ['questionnaires', questionnaireId, 'responses', { offset }] as const,
  detail: (questionnaireId: string, responseId: string) =>
    ['questionnaires', questionnaireId, 'responses', responseId] as const,
};

export function useResponses(
  questionnaireId: string | undefined,
  offset: number,
): UseQueryResult<ResponsePage> {
  return useQuery({
    queryKey: responseKeys.list(questionnaireId ?? '', offset),
    queryFn: () =>
      api.listResponses(questionnaireId as string, { limit: RESPONSES_PAGE_SIZE, offset }),
    enabled: Boolean(questionnaireId),
    // Analysis lands asynchronously, so a list left open should catch up.
    refetchInterval: 15_000,
  });
}

export function useResponseDetail(
  questionnaireId: string | undefined,
  responseId: string | undefined,
): UseQueryResult<ResponseDetail> {
  return useQuery({
    queryKey: responseKeys.detail(questionnaireId ?? '', responseId ?? ''),
    queryFn: () => api.getResponse(questionnaireId as string, responseId as string),
    enabled: Boolean(questionnaireId && responseId),
  });
}
