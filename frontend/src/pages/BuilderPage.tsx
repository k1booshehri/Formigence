/**
 * Create and edit a questionnaire. Serves both `/new` and `/:id/edit`.
 *
 * The form is the source of truth: it loads once from the server, save sends
 * the whole form as a PATCH (or a POST the first time), and leaving with
 * unsaved edits prompts first.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FormProvider, useFieldArray, useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiError, errorMessage, validationErrorLines } from '@/api/errors';
import {
  questionnaireFormSchema,
  type Questionnaire,
  type QuestionnaireFormValues,
  type QuestionType,
} from '@/api/schemas';
import { QueryState } from '@/components/QueryState';
import { QuestionCard } from '@/components/builder/QuestionCard';
import { PublishPanel } from '@/components/builder/PublishPanel';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form-controls';
import { Alert, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import {
  useCreateQuestionnaire,
  useQuestionnaire,
  useUpdateQuestionnaire,
} from '@/hooks/useQuestionnaires';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { QUESTION_TYPE_HINTS, QUESTION_TYPE_LABELS, blankQuestion, serializeQuestion } from '@/lib/questions';

const QUESTION_TYPES: QuestionType[] = ['multiple_choice', 'scale', 'short_text'];

const EMPTY_FORM: QuestionnaireFormValues = {
  title: '',
  description: '',
  analysis_guide: '',
  schema: [],
};

function toFormValues(questionnaire: Questionnaire): QuestionnaireFormValues {
  return {
    title: questionnaire.title,
    description: questionnaire.description ?? '',
    analysis_guide: questionnaire.analysis_guide,
    // Optional labels come back as null; the inputs need strings.
    schema: questionnaire.schema.map((question) =>
      question.type === 'scale'
        ? { ...question, min_label: question.min_label ?? '', max_label: question.max_label ?? '' }
        : question,
    ),
  };
}

export default function BuilderPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const isNew = id === undefined;
  const questionnaire = useQuestionnaire(id);

  if (isNew) return <BuilderForm initialValues={EMPTY_FORM} />;

  return (
    <QueryState
      query={questionnaire}
      errorTitle="Could not load this questionnaire"
      notFound={<NotFound />}
    >
      {(data) => (
        <BuilderForm
          key={data.id}
          questionnaire={data}
          initialValues={toFormValues(data)}
        />
      )}
    </QueryState>
  );
}

function NotFound(): JSX.Element {
  return (
    <Card>
      <CardContent className="space-y-3 py-12 text-center">
        <p className="font-medium">That questionnaire does not exist</p>
        <p className="text-sm text-muted-foreground">
          It may have been deleted, or the link may be wrong.
        </p>
        <Button asChild variant="outline">
          <Link to="/app/questionnaires">Back to questionnaires</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

interface BuilderFormProps {
  questionnaire?: Questionnaire;
  initialValues: QuestionnaireFormValues;
}

function BuilderForm({ questionnaire, initialValues }: BuilderFormProps): JSX.Element {
  const navigate = useNavigate();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const form = useForm<QuestionnaireFormValues>({
    resolver: zodResolver(questionnaireFormSchema),
    defaultValues: initialValues,
    mode: 'onSubmit',
  });
  const { fields, append, remove, move } = useFieldArray({
    control: form.control,
    name: 'schema',
  });

  const create = useCreateQuestionnaire();
  const update = useUpdateQuestionnaire(questionnaire?.id ?? '');
  const saveError = create.error ?? update.error;
  const isSaving = create.isPending || update.isPending;

  const isDirty = form.formState.isDirty;
  const { allowNextNavigation } = useUnsavedChangesWarning(isDirty && !isSaving);

  // Clear the "Saved" note as soon as the form is edited again.
  useEffect(() => {
    if (isDirty) setSavedAt(null);
  }, [isDirty]);

  const onSubmit = form.handleSubmit(async (values) => {
    const payload = {
      title: values.title,
      description: values.description.trim() ? values.description : null,
      analysis_guide: values.analysis_guide,
      schema: values.schema.map(serializeQuestion),
    };

    // `.catch(null)` on the mutation alone: its rejection is already rendered
    // from mutation state, and catching only here keeps any other failure in
    // this handler from being swallowed with it.
    if (questionnaire) {
      const saved = await update.mutateAsync(payload).catch(() => null);
      if (saved === null) return;
      form.reset(toFormValues(saved));
      setSavedAt(Date.now());
    } else {
      const created = await create.mutateAsync(payload).catch(() => null);
      if (created === null) return;
      // The form is still dirty at this point, so the unsaved-changes blocker
      // would otherwise prompt on the way to the page we just created.
      allowNextNavigation();
      // Replace, so Back does not return to the empty "new" form.
      navigate(`/app/questionnaires/${created.id}/edit`, { replace: true });
    }
  });

  const addQuestion = (type: QuestionType): void => {
    append(blankQuestion(type));
  };

  return (
    <FormProvider {...form}>
      <form
        onSubmit={(event) => {
          // Deliberately unguarded: a rejection here is a bug in the handler,
          // not an API failure, and swallowing it would leave Save looking
          // like it does nothing at all.
          void onSubmit(event);
        }}
        className="space-y-6"
        noValidate
      >
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/app/questionnaires">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">
            {questionnaire ? 'Edit questionnaire' : 'New questionnaire'}
          </h1>
          <div className="ml-auto flex items-center gap-3">
            {savedAt !== null && !isDirty && (
              <span className="text-sm text-muted-foreground" role="status">
                Saved
              </span>
            )}
            <Button type="submit" loading={isSaving} disabled={!isDirty}>
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        {saveError && <SaveError error={saveError} />}

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Title" error={form.formState.errors.title?.message}>
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  {...form.register('title')}
                  placeholder="Growth readiness check"
                />
              )}
            </Field>
            <Field
              label="Description"
              hint="Shown to respondents above the questions."
              error={form.formState.errors.description?.message}
            >
              {(fieldProps) => (
                <Textarea {...fieldProps} {...form.register('description')} rows={2} />
              )}
            </Field>
            <Field
              label="Analysis guide"
              hint="Private. Describe how answers should be interpreted — respondents never see this, and it is never sent to their browser."
              error={form.formState.errors.analysis_guide?.message}
            >
              {(fieldProps) => (
                <Textarea
                  {...fieldProps}
                  {...form.register('analysis_guide')}
                  rows={8}
                  placeholder="Weigh pricing confidence heaviest. Recommend exactly one next step."
                />
              )}
            </Field>
          </CardContent>
        </Card>

        {questionnaire && <PublishPanel questionnaire={questionnaire} disabled={isDirty} />}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Questions</h2>
            <span className="text-sm text-muted-foreground">{fields.length} added</span>
          </div>

          {typeof form.formState.errors.schema?.message === 'string' && (
            <Alert variant="destructive" title="Check the questions">
              <p>{form.formState.errors.schema.message}</p>
            </Alert>
          )}

          {fields.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No questions yet. Add one to get started — a questionnaire needs at least one.
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-3">
              {fields.map((field, index) => (
                // `field.id` is React Hook Form's own key, not the question id.
                <li key={field.id}>
                  <QuestionCard
                    index={index}
                    total={fields.length}
                    type={form.getValues(`schema.${index}.type`)}
                    onMoveUp={() => move(index, index - 1)}
                    onMoveDown={() => move(index, index + 1)}
                    onRemove={() => remove(index)}
                  />
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            {QUESTION_TYPES.map((type) => (
              <Button
                key={type}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addQuestion(type)}
                title={QUESTION_TYPE_HINTS[type]}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {QUESTION_TYPE_LABELS[type]}
              </Button>
            ))}
          </div>
        </section>
      </form>
    </FormProvider>
  );
}

/** Surface a backend rejection, expanding field-level validation detail. */
function SaveError({ error }: { error: unknown }): JSX.Element {
  const lines = validationErrorLines(error);
  const title = error instanceof ApiError && error.status === 422 ? 'The server rejected this' : 'Could not save';
  return (
    <Alert variant="destructive" title={title}>
      <p>{errorMessage(error)}</p>
      {lines.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
