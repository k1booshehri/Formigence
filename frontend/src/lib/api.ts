/**
 * Typed API client.
 *
 * Access tokens are short-lived, so a 401 triggers a single refresh attempt and
 * one replay of the original request. Concurrent 401s share one refresh promise
 * so a page with several queries does not burn several refresh tokens.
 */

import type {
  ApiErrorBody,
  PublicQuestionnaire,
  Questionnaire,
  TokenPair,
  User,
} from './types';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(
  /\/$/,
  '',
);

const ACCESS_TOKEN_KEY = 'formigence.access_token';
const REFRESH_TOKEN_KEY = 'formigence.refresh_token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  save(tokens: TokenPair): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function toApiError(response: Response): Promise<ApiError> {
  let code = 'http_error';
  let message = response.statusText || 'Request failed';
  let details: unknown;
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (body.error) {
      code = body.error.code;
      message = body.error.message;
      details = body.error.details;
    }
  } catch {
    // Non-JSON error body; keep the status-derived defaults.
  }
  return new ApiError(response.status, code, message, details);
}

let refreshInFlight: Promise<TokenPair | null> | null = null;

async function refreshTokens(): Promise<TokenPair | null> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return null;

  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) {
        tokenStore.clear();
        return null;
      }
      const tokens = (await response.json()) as TokenPair;
      tokenStore.save(tokens);
      return tokens;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function send(path: string, options: RequestOptions, accessToken: string | null) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  return fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const useAuth = options.auth ?? false;
  let response = await send(path, options, useAuth ? tokenStore.access : null);

  if (response.status === 401 && useAuth) {
    const tokens = await refreshTokens();
    if (tokens) {
      response = await send(path, options, tokens.access_token);
    }
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  health: () => request<{ status: string; environment: string }>('/health'),

  requestOtp: (email: string) =>
    request<{ message: string }>('/auth/request-otp', {
      method: 'POST',
      body: { email },
    }),

  verifyOtp: async (email: string, code: string) => {
    const tokens = await request<TokenPair>('/auth/verify-otp', {
      method: 'POST',
      body: { email, code },
    });
    tokenStore.save(tokens);
    return tokens;
  },

  me: () => request<User>('/me', { auth: true }),

  listQuestionnaires: () => request<Questionnaire[]>('/questionnaires', { auth: true }),

  getQuestionnaire: (id: string) =>
    request<Questionnaire>(`/questionnaires/${id}`, { auth: true }),

  createQuestionnaire: (payload: {
    title: string;
    description?: string | null;
    schema: Questionnaire['schema'];
    analysis_guide?: string;
  }) => request<Questionnaire>('/questionnaires', { method: 'POST', body: payload, auth: true }),

  publishQuestionnaire: (id: string) =>
    request<Questionnaire>(`/questionnaires/${id}/publish`, { method: 'POST', auth: true }),

  deleteQuestionnaire: (id: string) =>
    request<void>(`/questionnaires/${id}`, { method: 'DELETE', auth: true }),

  getPublicQuestionnaire: (slug: string) =>
    request<PublicQuestionnaire>(`/public/questionnaires/${slug}`),
};
