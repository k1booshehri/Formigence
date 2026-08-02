/**
 * The single place that talks to the API.
 *
 * Responsibilities, and nothing else:
 *  - attach the access token to authenticated requests
 *  - on a 401, attempt one refresh and replay the request once
 *  - when refresh fails, clear the session so the router redirects to /login
 *  - normalize the backend error envelope into `ApiError`
 *  - validate every response against the Zod schema the caller expects
 *
 * Validating responses is deliberate: a contract drift between the backend
 * schemas and `schemas.ts` surfaces as a loud `ApiContractError` at the
 * boundary rather than as `undefined` somewhere deep in a component.
 */
import type { z } from 'zod';

import { ApiContractError, ApiError, type ApiErrorBody } from './errors';
import { tokenPairSchema, type TokenPair } from './schemas';
import { tokenStore } from './tokens';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Send the access token and refresh-and-retry on 401. Default false. */
  auth?: boolean;
  signal?: AbortSignal;
}

async function toApiError(response: Response, path: string): Promise<ApiError> {
  let code = 'http_error';
  let message = response.statusText || `Request to ${path} failed`;
  let details: unknown;
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (body.error) {
      code = body.error.code;
      message = body.error.message;
      details = body.error.details;
    }
  } catch {
    // Non-JSON body (a proxy error page, say) — keep the status-derived text.
  }
  return new ApiError(response.status, code, message, details);
}

/**
 * Shared across concurrent callers so a page with several queries performs one
 * refresh rather than one per in-flight request — which would burn the rotating
 * refresh token and log the user out.
 */
let refreshInFlight: Promise<TokenPair | null> | null = null;

async function refreshSession(): Promise<TokenPair | null> {
  const refreshToken = tokenStore.getRefreshToken();
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
      const tokens = tokenPairSchema.parse(await response.json());
      tokenStore.save(tokens);
      return tokens;
    } catch {
      tokenStore.clear();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function send(path: string, options: RequestOptions, accessToken: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  return fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
}

/**
 * Perform a request and parse the result with `schema`.
 *
 * Pass `schema` as `null` for endpoints that return no body (204).
 */
export async function request<T>(
  path: string,
  schema: z.ZodType<T> | null,
  options: RequestOptions = {},
): Promise<T> {
  const useAuth = options.auth ?? false;
  let response = await send(path, options, useAuth ? tokenStore.getAccessToken() : null);

  if (response.status === 401 && useAuth) {
    const tokens = await refreshSession();
    if (tokens) {
      response = await send(path, options, tokens.access_token);
    }
    if (response.status === 401) {
      // Refresh failed, or the replay was rejected too. Dropping the tokens
      // flips the auth context to signed-out, and ProtectedRoute redirects.
      tokenStore.clear();
      throw await toApiError(response, path);
    }
  }

  if (!response.ok) throw await toApiError(response, path);

  if (schema === null || response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new ApiContractError(path, cause);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new ApiContractError(path, parsed.error);
  return parsed.data;
}

/** For endpoints that return 204 and have nothing to parse. */
export function requestNoContent(path: string, options: RequestOptions = {}): Promise<void> {
  return request<void>(path, null, options);
}
