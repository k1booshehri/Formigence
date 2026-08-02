/**
 * The respondent's page: one screen, every question, mobile first.
 *
 * Validation mirrors the backend rules (see `answersSchemaFor`), and a 422 from
 * the server is mapped back onto the individual questions so the respondent can
 * fix everything in one pass.
 */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { api } from '@/api/endpoints';
import { ApiError, answerErrorsFrom, errorMessage } from '@/api/errors';
import {
  answersSchemaFor,
  type AnswerMap,
  type AnswerValue,
  type Question,
} from '@/api/schemas';
import { QueryState } from '@/components/QueryState';
import { QuestionField } from '@/components/public/QuestionField';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardContent } from '@/components/ui/primitives';
import { usePublicQuestionnaire } from '@/hooks/usePublicQuestionnaire';

export default function PublicQuestionnairePage(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();
  const questionnaire = usePublicQuestionnaire(slug);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <QueryState
        query={questionnaire}
        errorTitle="Could not load this questionnaire"
        notFound={<QuestionnaireNotFound />}
      >
        {(data) => <AnswerForm slug={data.public_slug} questionnaire={data} />}
      </QueryState>
    </main>
  );
}

export function QuestionnaireNotFound(): JSX.Element {
  return (
    <Card>
      <CardContent className="space-y-2 py-12 text-center">
        <h1 className="text-lg font-semibold">This questionnaire is not available</h1>
        <p className="text-sm text-muted-foreground">
          The link may be wrong, or the questionnaire may no longer be published. Check with
          whoever shared it with you.
        </p>
      </CardContent>
    </Card>
  );
}

interface AnswerFormProps {
  slug: string;
  questionnaire: { title: string; description: string | null; schema: Question[] };
}

function AnswerForm({ slug, questionnaire }: AnswerFormProps): JSX.Element {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = useMutation({
    mutationFn: (values: AnswerMap) => api.submitResponse(slug, values),
    onSuccess: (result) => navigate(`/q/${slug}/result/${result.response_id}`),
    onError: (error) => {
      // The backend reports every rejected question at once.
      const mapped = answerErrorsFrom(error);
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
    },
  });

  const setAnswer = (questionId: string, value: AnswerValue): void => {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    setFieldErrors((current) => {
      if (!(questionId in current)) return current;
      const next = { ...current };
      delete next[questionId];
      return next;
    });
  };

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const parsed = answersSchemaFor(questionnaire.schema).safeParse(answers);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !(key in errors)) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      focusFirstError(errors);
      return;
    }
    setFieldErrors({});
    submit.mutate(parsed.data);
  };

  const submitFailed = submit.isError && Object.keys(answerErrorsFrom(submit.error)).length === 0;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{questionnaire.title}</h1>
        {questionnaire.description && (
          <p className="text-muted-foreground">{questionnaire.description}</p>
        )}
        <p className="text-sm text-muted-foreground">All questions are required.</p>
      </header>

      <div className="space-y-4">
        {questionnaire.schema.map((question, index) => (
          <QuestionField
            key={question.id}
            question={question}
            index={index}
            value={answers[question.id]}
            error={fieldErrors[question.id]}
            onChange={(value) => setAnswer(question.id, value)}
          />
        ))}
      </div>

      {Object.keys(fieldErrors).length > 0 && (
        <Alert variant="destructive" title="Please check your answers">
          <p>
            {Object.keys(fieldErrors).length === 1
              ? 'One question needs attention.'
              : `${Object.keys(fieldErrors).length} questions need attention.`}
          </p>
        </Alert>
      )}

      {submitFailed && (
        <Alert variant="destructive" title="Could not submit">
          <p>{submitErrorMessage(submit.error)}</p>
        </Alert>
      )}

      <Button type="submit" className="w-full" size="lg" loading={submit.isPending}>
        {submit.isPending ? 'Submitting…' : 'Submit answers'}
      </Button>
    </form>
  );
}

function submitErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.isRateLimited) {
    return 'Too many submissions from this connection. Please try again later.';
  }
  if (error instanceof ApiError && error.isNotFound) {
    return 'This questionnaire is no longer accepting responses.';
  }
  return errorMessage(error);
}

/** Move focus to the first question with a problem. */
function focusFirstError(errors: Record<string, string>): void {
  const firstId = Object.keys(errors)[0];
  if (!firstId) return;
  const control = document.querySelector<HTMLElement>(`[name="${CSS.escape(firstId)}"]`);
  control?.focus();
}
