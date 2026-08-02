/**
 * One function per backend route, named for what it does.
 *
 * Paths and status codes mirror `backend/app/api/`. Hooks call these; nothing
 * else builds a URL.
 */
import { request, requestNoContent } from './client';
import {
  messageSchema,
  publicQuestionnaireSchema,
  questionnaireSchema,
  responseDetailSchema,
  responsePageSchema,
  responseStatusOutSchema,
  responseSubmitOutSchema,
  tokenPairSchema,
  userSchema,
  type AnswerMap,
  type PublicQuestionnaire,
  type Question,
  type Questionnaire,
  type ResponseDetail,
  type ResponsePage,
  type ResponseStatusOut,
  type ResponseSubmitOut,
  type TokenPair,
  type User,
} from './schemas';
import { z } from 'zod';

const questionnaireListSchema = z.array(questionnaireSchema);

export interface QuestionnaireWritePayload {
  title: string;
  description: string | null;
  /** The wire key is `schema`; see the note in schemas.ts. */
  schema: Question[];
  analysis_guide: string;
}

export const api = {
  // --- Auth -------------------------------------------------------------
  /** Always 200, whether or not the address is registered. */
  requestOtp(email: string): Promise<{ message: string }> {
    return request('/auth/request-otp', messageSchema, { method: 'POST', body: { email } });
  },

  verifyOtp(email: string, code: string): Promise<TokenPair> {
    return request('/auth/verify-otp', tokenPairSchema, {
      method: 'POST',
      body: { email, code },
    });
  },

  me(): Promise<User> {
    return request('/me', userSchema, { auth: true });
  },

  // --- Questionnaires ---------------------------------------------------
  listQuestionnaires(): Promise<Questionnaire[]> {
    return request('/questionnaires', questionnaireListSchema, { auth: true });
  },

  getQuestionnaire(id: string): Promise<Questionnaire> {
    return request(`/questionnaires/${id}`, questionnaireSchema, { auth: true });
  },

  createQuestionnaire(payload: QuestionnaireWritePayload): Promise<Questionnaire> {
    return request('/questionnaires', questionnaireSchema, {
      method: 'POST',
      body: payload,
      auth: true,
    });
  },

  /**
   * PATCH applies only the keys present in the body. The builder sends the
   * whole form, which is what "the form is the source of truth" means.
   */
  updateQuestionnaire(
    id: string,
    payload: Partial<QuestionnaireWritePayload>,
  ): Promise<Questionnaire> {
    return request(`/questionnaires/${id}`, questionnaireSchema, {
      method: 'PATCH',
      body: payload,
      auth: true,
    });
  },

  deleteQuestionnaire(id: string): Promise<void> {
    return requestNoContent(`/questionnaires/${id}`, { method: 'DELETE', auth: true });
  },

  publishQuestionnaire(id: string): Promise<Questionnaire> {
    return request(`/questionnaires/${id}/publish`, questionnaireSchema, {
      method: 'POST',
      auth: true,
    });
  },

  unpublishQuestionnaire(id: string): Promise<Questionnaire> {
    return request(`/questionnaires/${id}`, questionnaireSchema, {
      method: 'PATCH',
      body: { is_published: false },
      auth: true,
    });
  },

  // --- Responses (owner) -------------------------------------------------
  listResponses(
    questionnaireId: string,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<ResponsePage> {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return request(`/questionnaires/${questionnaireId}/responses?${query}`, responsePageSchema, {
      auth: true,
    });
  },

  getResponse(questionnaireId: string, responseId: string): Promise<ResponseDetail> {
    return request(
      `/questionnaires/${questionnaireId}/responses/${responseId}`,
      responseDetailSchema,
      { auth: true },
    );
  },

  // --- Public ------------------------------------------------------------
  getPublicQuestionnaire(slug: string): Promise<PublicQuestionnaire> {
    return request(`/public/questionnaires/${encodeURIComponent(slug)}`, publicQuestionnaireSchema);
  },

  submitResponse(slug: string, answers: AnswerMap): Promise<ResponseSubmitOut> {
    return request(
      `/public/questionnaires/${encodeURIComponent(slug)}/responses`,
      responseSubmitOutSchema,
      { method: 'POST', body: { answers } },
    );
  },

  getResponseStatus(responseId: string, signal?: AbortSignal): Promise<ResponseStatusOut> {
    return request(`/public/responses/${responseId}`, responseStatusOutSchema, { signal });
  },
};
