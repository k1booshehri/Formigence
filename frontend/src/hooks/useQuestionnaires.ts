/** Server state for questionnaires. Pages call these; none call the API directly. */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { api, type QuestionnaireWritePayload } from '@/api/endpoints';
import type { Questionnaire } from '@/api/schemas';

export const questionnaireKeys = {
  all: ['questionnaires'] as const,
  detail: (id: string) => ['questionnaires', id] as const,
};

export function useQuestionnaires(): UseQueryResult<Questionnaire[]> {
  return useQuery({ queryKey: questionnaireKeys.all, queryFn: api.listQuestionnaires });
}

export function useQuestionnaire(id: string | undefined): UseQueryResult<Questionnaire> {
  return useQuery({
    queryKey: questionnaireKeys.detail(id ?? ''),
    queryFn: () => api.getQuestionnaire(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateQuestionnaire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: QuestionnaireWritePayload) => api.createQuestionnaire(payload),
    onSuccess: (questionnaire) => {
      queryClient.setQueryData(questionnaireKeys.detail(questionnaire.id), questionnaire);
      void queryClient.invalidateQueries({ queryKey: questionnaireKeys.all });
    },
  });
}

export function useUpdateQuestionnaire(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<QuestionnaireWritePayload>) =>
      api.updateQuestionnaire(id, payload),
    onSuccess: (questionnaire) => {
      queryClient.setQueryData(questionnaireKeys.detail(id), questionnaire);
      void queryClient.invalidateQueries({ queryKey: questionnaireKeys.all });
    },
  });
}

export function useDeleteQuestionnaire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteQuestionnaire(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: questionnaireKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: questionnaireKeys.all });
    },
  });
}

export function usePublishQuestionnaire(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (publish: boolean) =>
      publish ? api.publishQuestionnaire(id) : api.unpublishQuestionnaire(id),
    onSuccess: (questionnaire) => {
      queryClient.setQueryData(questionnaireKeys.detail(id), questionnaire);
      void queryClient.invalidateQueries({ queryKey: questionnaireKeys.all });
    },
  });
}
