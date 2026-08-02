/** Helpers for constructing and describing questions in the builder. */
import type { Question, QuestionType } from '@/api/schemas';

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Multiple choice',
  scale: 'Scale',
  short_text: 'Short text',
};

export const QUESTION_TYPE_HINTS: Record<QuestionType, string> = {
  multiple_choice: 'Pick from a fixed list of options.',
  scale: 'Rate on a numeric range, with optional labels at each end.',
  short_text: 'A free-text answer.',
};

/**
 * Generate a question id.
 *
 * Ids are internal but must satisfy the backend's `^[A-Za-z0-9_-]+$` and stay
 * stable for the life of the question — they are the keys of every stored
 * answer, so changing one would orphan the answers already collected.
 */
export function generateQuestionId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `q_${suffix}`;
}

export function blankQuestion(type: QuestionType): Question {
  const id = generateQuestionId();
  switch (type) {
    case 'multiple_choice':
      return { id, type, prompt: '', options: ['', ''], allow_multiple: false };
    case 'scale':
      return { id, type, prompt: '', min: 1, max: 5, min_label: '', max_label: '' };
    case 'short_text':
      return { id, type, prompt: '', max_length: null };
  }
}

/**
 * Strip UI-only empties before sending to the API.
 *
 * The builder uses `''` for "no label" because an empty input yields a string,
 * but the backend's `Label` type rejects empty strings — it wants the key
 * absent or null.
 */
export function serializeQuestion(question: Question): Question {
  switch (question.type) {
    case 'scale':
      return {
        ...question,
        min_label: question.min_label?.trim() ? question.min_label.trim() : null,
        max_label: question.max_label?.trim() ? question.max_label.trim() : null,
      };
    case 'short_text':
      return {
        ...question,
        max_length: question.max_length ?? null,
      };
    case 'multiple_choice':
      return { ...question, options: question.options.map((option) => option.trim()) };
  }
}
