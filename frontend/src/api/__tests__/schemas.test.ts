/**
 * The Zod mirrors must accept and reject exactly what the backend does.
 *
 * The cases below are lifted from `backend/tests/test_schema_validation.py`
 * and `backend/tests/test_submissions.py`, so a divergence between the two
 * layers shows up as a failure here.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { describe, expect, it } from 'vitest';

import {
  answersSchemaFor,
  questionListSchema,
  questionSchema,
  questionnaireFormSchema,
  type Question,
  type QuestionnaireFormValues,
} from '@/api/schemas';

const multipleChoice = {
  id: 'q1',
  type: 'multiple_choice',
  prompt: 'Pick one',
  options: ['a', 'b'],
  allow_multiple: false,
} as const;

const scale = { id: 'q1', type: 'scale', prompt: 'Rate', min: 1, max: 5 } as const;
const shortText = { id: 'q1', type: 'short_text', prompt: 'Describe' } as const;

describe('question schema — accepts what the backend accepts', () => {
  it.each([
    ['all three types', [multipleChoice, { ...scale, id: 'b' }, { ...shortText, id: 'c' }]],
    ['scale with labels', [{ ...scale, min_label: 'Low', max_label: 'High' }]],
    ['scale with a negative minimum', [{ ...scale, min: -5, max: 5 }]],
    ['short text without max_length', [shortText]],
    ['choice allowing multiple', [{ ...multipleChoice, allow_multiple: true }]],
  ])('%s', (_name, value) => {
    expect(questionListSchema.safeParse(value).success).toBe(true);
  });
});

describe('question schema — rejects what the backend rejects', () => {
  it.each([
    ['empty list', []],
    ['unknown type', [{ id: 'q1', type: 'ranking', prompt: 'Order these' }]],
    ['missing type', [{ id: 'q1', prompt: 'No type given' }]],
    ['missing id', [{ type: 'short_text', prompt: 'No id' }]],
    ['missing prompt', [{ id: 'q1', type: 'short_text' }]],
    ['empty prompt', [{ ...shortText, prompt: '' }]],
    ['id with spaces', [{ ...shortText, id: 'not a slug' }]],
    ['unknown key', [{ ...shortText, extra: 'surprise' }]],
    ['duplicate ids', [{ ...shortText, id: 'dup' }, { ...multipleChoice, id: 'dup' }]],
    ['choice with one option', [{ ...multipleChoice, options: ['only'] }]],
    ['choice with no options', [{ ...multipleChoice, options: [] }]],
    ['choice with duplicate options', [{ ...multipleChoice, options: ['a', 'a'] }]],
    ['choice options not strings', [{ ...multipleChoice, options: [1, 2] }]],
    ['scale max below min', [{ ...scale, min: 5, max: 1 }]],
    ['scale max equals min', [{ ...scale, min: 3, max: 3 }]],
    ['scale span too wide', [{ ...scale, min: 0, max: 1000 }]],
    ['scale missing bounds', [{ id: 'q1', type: 'scale', prompt: 'Rate' }]],
    ['scale non-integer bounds', [{ ...scale, min: 1.5, max: 5 }]],
    ['text max_length of zero', [{ ...shortText, max_length: 0 }]],
    ['text max_length negative', [{ ...shortText, max_length: -5 }]],
  ])('%s', (_name, value) => {
    expect(questionListSchema.safeParse(value).success).toBe(false);
  });

  it('rejects more than 100 questions', () => {
    const many = Array.from({ length: 101 }, (_value, index) => ({
      ...shortText,
      id: `q${index}`,
    }));
    expect(questionListSchema.safeParse(many).success).toBe(false);
  });
});

describe('question schema narrows on type', () => {
  it('parses into a usable discriminated union', () => {
    const parsed = questionSchema.parse(multipleChoice);
    expect(parsed.type).toBe('multiple_choice');
    if (parsed.type === 'multiple_choice') {
      expect(parsed.options).toEqual(['a', 'b']);
    }
  });
});

// --- Answers ------------------------------------------------------------------
// Mirrors backend/app/services/answers.py

const questions: Question[] = [
  {
    id: 'q1',
    type: 'multiple_choice',
    prompt: 'Which channels do you sell through?',
    options: ['Retail', 'Online', 'Wholesale'],
    allow_multiple: true,
  },
  { id: 'q2', type: 'scale', prompt: 'Confidence?', min: 1, max: 5 },
  { id: 'q3', type: 'short_text', prompt: 'Bottleneck?', max_length: 500 },
];

const validAnswers = { q1: ['Retail', 'Online'], q2: 4, q3: 'Hiring.' };

describe('answer validation mirrors the backend', () => {
  it('accepts a valid submission', () => {
    expect(answersSchemaFor(questions).safeParse(validAnswers).success).toBe(true);
  });

  it.each([
    ['wrong option', { ...validAnswers, q1: ['Carrier pigeon'] }],
    ['option list is a bare string', { ...validAnswers, q1: 'Retail' }],
    ['empty option list', { ...validAnswers, q1: [] }],
    ['duplicate options', { ...validAnswers, q1: ['Retail', 'Retail'] }],
    ['scale above max', { ...validAnswers, q2: 9 }],
    ['scale below min', { ...validAnswers, q2: 0 }],
    ['scale as a string', { ...validAnswers, q2: '4' }],
    ['short text empty', { ...validAnswers, q3: '   ' }],
    ['short text too long', { ...validAnswers, q3: 'x'.repeat(501) }],
    ['short text not a string', { ...validAnswers, q3: 42 }],
  ])('rejects %s', (_name, answers) => {
    expect(answersSchemaFor(questions).safeParse(answers).success).toBe(false);
  });

  it('requires every question', () => {
    const { q2: _omitted, ...missing } = validAnswers;
    const result = answersSchemaFor(questions).safeParse(missing);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'q2')).toBe(true);
    }
  });

  it('reports every problem at once, like the backend does', () => {
    const result = answersSchemaFor(questions).safeParse({ q1: ['Nope'], q2: 99, q3: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = new Set(result.error.issues.map((issue) => issue.path[0]));
      expect(paths).toEqual(new Set(['q1', 'q2', 'q3']));
    }
  });

  it('falls back to the 5000-character cap when max_length is unset', () => {
    const unbounded: Question[] = [{ id: 'q1', type: 'short_text', prompt: 'Tell me' }];
    const schema = answersSchemaFor(unbounded);
    expect(schema.safeParse({ q1: 'x'.repeat(5000) }).success).toBe(true);
    expect(schema.safeParse({ q1: 'x'.repeat(5001) }).success).toBe(false);
  });
});

/**
 * The builder reads field errors by path, so where a message lands is part of
 * the contract between Zod, the resolver and `QuestionCard` — not an internal
 * detail. These pin it.
 */
describe('the builder resolver reports errors on precise paths', () => {
  const resolve = zodResolver(questionnaireFormSchema);

  async function errorsForQuestion(question: unknown): Promise<Record<string, unknown>> {
    const values = {
      title: 'Growth check',
      description: '',
      analysis_guide: '',
      schema: [question],
    } as unknown as QuestionnaireFormValues;
    const { errors } = await resolve(values, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
      criteriaMode: 'firstError',
    });
    const questions = errors.schema as unknown as
      | Record<number, Record<string, unknown> | undefined>
      | undefined;
    return questions?.[0] ?? {};
  }

  function messageOf(node: unknown): string | undefined {
    if (typeof node !== 'object' || node === null) return undefined;
    const message = (node as { message?: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }

  it('reports a duplicate option against the option list', async () => {
    const question = await errorsForQuestion({ ...multipleChoice, options: ['Online', 'Online'] });
    expect(messageOf(question.options)).toBe('Options must be unique');
  });

  it('reports an empty option against that option', async () => {
    const question = await errorsForQuestion({ ...multipleChoice, options: ['Online', ''] });
    const options = question.options as unknown[];
    expect(messageOf(options[1])).toBe('An option cannot be empty');
  });

  it('reports a missing prompt against the prompt', async () => {
    const question = await errorsForQuestion({ ...multipleChoice, prompt: '' });
    expect(messageOf(question.prompt)).toBe('A question prompt is required');
  });

  it('reports an impossible scale against the maximum', async () => {
    const question = await errorsForQuestion({ ...scale, min: 5, max: 1 });
    expect(messageOf(question.max)).toBe('The maximum must be greater than the minimum');
  });
});
