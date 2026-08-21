/**
 * Zod mirrors of the backend Pydantic schemas.
 *
 * These must stay in lockstep with `backend/app/schemas/`. Where the backend
 * applies a constraint, the same constraint appears here with the same bound,
 * so the client rejects what the server would reject — the referenced Python
 * constant is named in a comment beside each one.
 *
 * The wire key for a questionnaire's questions is `schema` (the backend field
 * is named `questions` and aliased); this file uses the wire name.
 */
import { z } from 'zod';

// --- Question definitions -----------------------------------------------------
// Mirrors backend/app/schemas/questions.py

/** QuestionId: min_length=1, max_length=64, pattern ^[A-Za-z0-9_-]+$ */
export const questionIdSchema = z
  .string()
  .min(1, 'Required')
  .max(64, 'At most 64 characters')
  .regex(/^[A-Za-z0-9_-]+$/, 'Use only letters, numbers, hyphens and underscores');

/** Prompt: min_length=1, max_length=1000, strip_whitespace */
export const promptSchema = z
  .string()
  .trim()
  .min(1, 'A question prompt is required')
  .max(1000, 'At most 1000 characters');

/** OptionText: min_length=1, max_length=300, strip_whitespace */
export const optionTextSchema = z
  .string()
  .trim()
  .min(1, 'An option cannot be empty')
  .max(300, 'At most 300 characters');

/** Label: min_length=1, max_length=100, strip_whitespace */
export const labelSchema = z
  .string()
  .trim()
  .min(1, 'A label cannot be empty')
  .max(100, 'At most 100 characters');

/** MAX_QUESTIONS */
export const MAX_QUESTIONS = 100;
/** MAX_SCALE_SPAN */
export const MAX_SCALE_SPAN = 100;
/** DEFAULT_SHORT_TEXT_MAX_LENGTH in backend/app/services/answers.py */
export const DEFAULT_SHORT_TEXT_MAX_LENGTH = 5000;

export const multipleChoiceQuestionSchema = z
  .object({
    id: questionIdSchema,
    type: z.literal('multiple_choice'),
    prompt: promptSchema,
    // options: min_length=2, max_length=50
    options: z
      .array(optionTextSchema)
      .min(2, 'Add at least two options')
      .max(50, 'At most 50 options'),
    allow_multiple: z.boolean(),
  })
  .strict();

export const scaleQuestionSchema = z
  .object({
    id: questionIdSchema,
    type: z.literal('scale'),
    prompt: promptSchema,
    min: z.number().int('Must be a whole number'),
    max: z.number().int('Must be a whole number'),
    min_label: labelSchema.nullish(),
    max_label: labelSchema.nullish(),
  })
  .strict();

export const shortTextQuestionSchema = z
  .object({
    id: questionIdSchema,
    type: z.literal('short_text'),
    prompt: promptSchema,
    // max_length: ge=1, le=5000
    max_length: z
      .number()
      .int('Must be a whole number')
      .min(1, 'Must be at least 1')
      .max(5000, 'At most 5000')
      .nullish(),
  })
  .strict();

/**
 * The discriminated union, plus the cross-field rules.
 *
 * The rules live in one `superRefine` rather than on the members because
 * `z.discriminatedUnion` only accepts plain objects, and dispatching on `type`
 * is what makes the errors usable: a wrong option is reported against that
 * question's `options`, where the builder shows it, instead of as one
 * union-wide "invalid input" on the question as a whole.
 */
export const questionSchema = z
  .discriminatedUnion('type', [
    multipleChoiceQuestionSchema,
    scaleQuestionSchema,
    shortTextQuestionSchema,
  ])
  .superRefine((question, ctx) => {
    if (question.type === 'multiple_choice') {
      if (new Set(question.options).size !== question.options.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Options must be unique',
          path: ['options'],
        });
      }
      return;
    }
    if (question.type === 'scale') {
      if (question.max <= question.min) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'The maximum must be greater than the minimum',
          path: ['max'],
        });
      } else if (question.max - question.min > MAX_SCALE_SPAN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `The scale must not span more than ${MAX_SCALE_SPAN} points`,
          path: ['max'],
        });
      }
    }
  });

/** QuestionList: min_length=1, max_length=MAX_QUESTIONS, unique ids */
export const questionListSchema = z
  .array(questionSchema)
  .min(1, 'Add at least one question')
  .max(MAX_QUESTIONS, `At most ${MAX_QUESTIONS} questions`)
  .refine(
    (questions) => new Set(questions.map((question) => question.id)).size === questions.length,
    { message: 'Question ids must be unique' },
  );

export type MultipleChoiceQuestion = z.infer<typeof multipleChoiceQuestionSchema>;
export type ScaleQuestion = z.infer<typeof scaleQuestionSchema>;
export type ShortTextQuestion = z.infer<typeof shortTextQuestionSchema>;
export type Question = z.infer<typeof questionSchema>;
export type QuestionType = Question['type'];

// --- Questionnaires -----------------------------------------------------------
// Mirrors backend/app/schemas/questionnaire.py

/** Title: min_length=1, max_length=200, strip_whitespace */
export const titleSchema = z
  .string()
  .trim()
  .min(1, 'A title is required')
  .max(200, 'At most 200 characters');

/** Description: max_length=5000 */
export const descriptionSchema = z.string().max(5000, 'At most 5000 characters');

/** AnalysisGuide: max_length=20000 */
export const analysisGuideSchema = z.string().max(20000, 'At most 20000 characters');

export const questionnaireSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  schema: questionListSchema,
  analysis_guide: z.string(),
  public_slug: z.string().nullable(),
  is_published: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const publicQuestionnaireSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  schema: questionListSchema,
  public_slug: z.string(),
});

export type Questionnaire = z.infer<typeof questionnaireSchema>;
export type PublicQuestionnaire = z.infer<typeof publicQuestionnaireSchema>;

/** The builder form. Validated before any write; mirrors QuestionnaireCreate. */
export const questionnaireFormSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  analysis_guide: analysisGuideSchema,
  schema: questionListSchema,
});

export type QuestionnaireFormValues = z.infer<typeof questionnaireFormSchema>;

// --- Responses ----------------------------------------------------------------
// Mirrors backend/app/schemas/response.py

export const responseStatusSchema = z.enum(['pending', 'processing', 'complete', 'failed']);
export const confidenceSchema = z.enum(['low', 'medium', 'high']);

export const recommendationSchema = z.object({
  recommendation: z.string(),
  reasoning: z.string(),
  confidence: confidenceSchema,
});

export const responseSubmitOutSchema = z.object({
  response_id: z.string().uuid(),
  status: responseStatusSchema,
});

export const responseStatusOutSchema = z.object({
  status: responseStatusSchema,
  result: recommendationSchema.nullable(),
});

export const responseSummarySchema = z.object({
  id: z.string().uuid(),
  submitted_at: z.string(),
  status: responseStatusSchema,
  recommendation_summary: z.string().nullable(),
  confidence: confidenceSchema.nullable(),
});

export const responseDetailSchema = z.object({
  id: z.string().uuid(),
  questionnaire_id: z.string().uuid(),
  submitted_at: z.string(),
  updated_at: z.string(),
  status: responseStatusSchema,
  answers: z.record(z.unknown()),
  ai_result: recommendationSchema.nullable(),
});

export const responsePageSchema = z.object({
  items: z.array(responseSummarySchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export type ResponseStatus = z.infer<typeof responseStatusSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type ResponseSubmitOut = z.infer<typeof responseSubmitOutSchema>;
export type ResponseStatusOut = z.infer<typeof responseStatusOutSchema>;
export type ResponseSummary = z.infer<typeof responseSummarySchema>;
export type ResponseDetail = z.infer<typeof responseDetailSchema>;
export type ResponsePage = z.infer<typeof responsePageSchema>;

// --- Auth ---------------------------------------------------------------------
// Mirrors backend/app/schemas/auth.py and app/schemas/user.py

export const tokenPairSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.literal('bearer'),
  expires_in: z.number().int(),
});

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  created_at: z.string(),
});

export const messageSchema = z.object({ message: z.string() });

export type TokenPair = z.infer<typeof tokenPairSchema>;
export type User = z.infer<typeof userSchema>;

export const emailFormSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address').email('Enter a valid email address'),
});

/** OtpVerifyIn.code: min_length=4, max_length=10, strip_whitespace */
export const otpFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, 'Enter the code from your email')
    .max(10, 'That code is too long')
    .regex(/^\d+$/, 'The code is all digits'),
});

export type EmailFormValues = z.infer<typeof emailFormSchema>;
export type OtpFormValues = z.infer<typeof otpFormSchema>;

// --- Answers ------------------------------------------------------------------

/** One respondent answer, keyed by question id. */
export type AnswerValue = string | string[] | number;
export type AnswerMap = Record<string, AnswerValue>;

/**
 * Build a validator for one question, mirroring
 * `backend/app/services/answers.py`. Every question is required — the backend
 * has no `optional` flag — so there is no "empty is fine" branch.
 */
export function answerSchemaForQuestion(question: Question): z.ZodType<AnswerValue> {
  switch (question.type) {
    case 'multiple_choice': {
      const allowed = question.options;
      if (question.allow_multiple) {
        return z
          .array(z.string())
          .min(1, 'Select at least one option')
          .refine((values) => new Set(values).size === values.length, {
            message: 'Options must not be repeated',
          })
          .refine((values) => values.every((value) => allowed.includes(value)), {
            message: 'Select an available option',
          }) as z.ZodType<AnswerValue>;
      }
      return z
        .string({ required_error: 'Select an option' })
        .refine((value) => allowed.includes(value), {
          message: 'Select an available option',
        }) as z.ZodType<AnswerValue>;
    }
    case 'scale': {
      const { min, max } = question;
      return z
        .number({
          required_error: 'Choose a value',
          invalid_type_error: 'Choose a value',
        })
        .int('Choose a whole number')
        .min(min, `Must be between ${min} and ${max}`)
        .max(max, `Must be between ${min} and ${max}`) as z.ZodType<AnswerValue>;
    }
    case 'short_text': {
      const limit = question.max_length ?? DEFAULT_SHORT_TEXT_MAX_LENGTH;
      return z
        .string()
        .trim()
        .min(1, 'An answer is required')
        .max(limit, `At most ${limit} characters`) as z.ZodType<AnswerValue>;
    }
  }
}

/** Validator for a whole submission, built from the questionnaire's schema. */
export function answersSchemaFor(questions: Question[]): z.ZodType<AnswerMap> {
  const shape: Record<string, z.ZodType<AnswerValue>> = {};
  for (const question of questions) {
    shape[question.id] = answerSchemaForQuestion(question);
  }
  return z.object(shape) as unknown as z.ZodType<AnswerMap>;
}
