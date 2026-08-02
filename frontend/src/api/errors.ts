/**
 * The backend's error envelope, and helpers for surfacing it in forms.
 *
 * Every backend error has the same shape (see backend/app/core/errors.py):
 *   { "error": { "code": "...", "message": "...", "details": ... } }
 */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

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

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

/** Thrown when a response body does not match the schema the client expects. */
export class ApiContractError extends Error {
  constructor(path: string, cause: unknown) {
    super(`The server returned an unexpected shape for ${path}`);
    this.name = 'ApiContractError';
    this.cause = cause;
  }
}

/** Turn any thrown value into a sentence worth showing a user. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof ApiContractError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

/** One entry of the `invalid_answers` 422 detail list. */
interface AnswerErrorDetail {
  question_id: string;
  message: string;
}

function isAnswerErrorDetail(value: unknown): value is AnswerErrorDetail {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.question_id === 'string' && typeof candidate.message === 'string';
}

/**
 * Map an `invalid_answers` 422 to `{ [questionId]: message }`.
 *
 * The backend reports every rejected question at once, so a respondent can fix
 * the whole submission in one pass rather than one field per round trip.
 */
export function answerErrorsFrom(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== 'invalid_answers') return {};
  if (!Array.isArray(error.details)) return {};
  const mapped: Record<string, string> = {};
  for (const entry of error.details) {
    if (isAnswerErrorDetail(entry)) mapped[entry.question_id] = entry.message;
  }
  return mapped;
}

/** One entry of FastAPI's own 422 detail list. */
interface ValidationErrorDetail {
  loc: (string | number)[];
  msg: string;
}

function isValidationErrorDetail(value: unknown): value is ValidationErrorDetail {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.loc) && typeof candidate.msg === 'string';
}

/**
 * Flatten FastAPI's `validation_error` details into readable lines.
 *
 * `loc` starts with the request part (`body`, `query`, ...), which is noise for
 * a user, so it is dropped. Note the wire name is used for the path — a
 * questionnaire's questions come back as `schema`, matching the form field.
 */
export function validationErrorLines(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== 'validation_error') return [];
  if (!Array.isArray(error.details)) return [];
  return error.details.filter(isValidationErrorDetail).map((entry) => {
    const path = entry.loc.slice(1).join('.');
    return path ? `${path}: ${entry.msg}` : entry.msg;
  });
}
