/**
 * One question in the builder, with the editor for its type.
 *
 * Two typing notes, both consequences of the questions array being a
 * discriminated union of shapes:
 *
 *  - React Hook Form's `FieldPath` cannot resolve members that exist on only
 *    one variant (`options`, `min`, `max_length`), so those registrations are
 *    cast to `FieldPath<QuestionnaireFormValues>`. The paths are real; the cast
 *    only silences the union arithmetic, and no `any` enters the code.
 *  - Errors are read through `questionError()` rather than property access,
 *    because the error object's type mirrors that same union.
 *
 * Options are managed with `useWatch` + `setValue` rather than `useFieldArray`:
 * that hook attaches an `id` to every element and so only supports arrays of
 * objects, while the API's options are plain strings.
 */
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { useFormContext, useWatch, type FieldErrors, type FieldPath } from 'react-hook-form';

import type { QuestionnaireFormValues, QuestionType } from '@/api/schemas';
import { Button } from '@/components/ui/button';
import { Field, Input, Label, Textarea } from '@/components/ui/form-controls';
import { Badge, Card, CardContent } from '@/components/ui/primitives';
import { QUESTION_TYPE_LABELS } from '@/lib/questions';

type FormPath = FieldPath<QuestionnaireFormValues>;

/** Read one question's error node without fighting the union's error type. */
function questionErrorNode(
  errors: FieldErrors<QuestionnaireFormValues>,
  index: number,
  key: string,
): unknown {
  const perQuestion = errors.schema as unknown as
    | Record<number, Record<string, unknown> | undefined>
    | undefined;
  return perQuestion?.[index]?.[key];
}

function errorMessageOf(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const message = (node as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

function questionError(
  errors: FieldErrors<QuestionnaireFormValues>,
  index: number,
  key: string,
): string | undefined {
  return errorMessageOf(questionErrorNode(errors, index, key));
}

interface QuestionCardProps {
  index: number;
  total: number;
  type: QuestionType;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

export function QuestionCard({
  index,
  total,
  type,
  onMoveUp,
  onMoveDown,
  onRemove,
}: QuestionCardProps): JSX.Element {
  const { register, formState } = useFormContext<QuestionnaireFormValues>();
  const position = index + 1;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {position}. {QUESTION_TYPE_LABELS[type]}
          </Badge>
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onMoveUp}
              disabled={index === 0}
              aria-label={`Move question ${position} up`}
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onMoveDown}
              disabled={index === total - 1}
              aria-label={`Move question ${position} down`}
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onRemove}
              aria-label={`Remove question ${position}`}
            >
              <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <Field label="Question" error={questionError(formState.errors, index, 'prompt')}>
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              {...register(`schema.${index}.prompt` as FormPath)}
              rows={2}
              placeholder="What would you like to ask?"
            />
          )}
        </Field>

        {type === 'multiple_choice' && <MultipleChoiceEditor index={index} />}
        {type === 'scale' && <ScaleEditor index={index} />}
        {type === 'short_text' && <ShortTextEditor index={index} />}
      </CardContent>
    </Card>
  );
}

const MIN_OPTIONS = 2;

function MultipleChoiceEditor({ index }: { index: number }): JSX.Element {
  const { control, register, setValue, formState } = useFormContext<QuestionnaireFormValues>();
  const fieldId = useId();
  const path = `schema.${index}.options` as FormPath;
  const watched = useWatch({ control, name: path }) as unknown;
  const options: string[] = Array.isArray(watched) ? (watched as string[]) : [];

  // Two shapes live at this path: a message about the list as a whole ("Options
  // must be unique") and, when individual entries are wrong, an array of
  // per-option errors. Both need showing, and either can be absent.
  const errorNode = questionErrorNode(formState.errors, index, 'options');
  const listError = errorMessageOf(errorNode);
  const optionError = (optionIndex: number): string | undefined =>
    Array.isArray(errorNode) ? errorMessageOf(errorNode[optionIndex]) : undefined;
  const hasError = Boolean(listError) || (Array.isArray(errorNode) && errorNode.some(Boolean));

  const replaceOptions = (next: string[]): void => {
    setValue(path, next as never, { shouldDirty: true, shouldValidate: hasError });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Options</Label>
        <ul className="space-y-2">
          {options.map((_option, optionIndex) => {
            const message = optionError(optionIndex);
            const errorId = `${fieldId}-option-${optionIndex}-error`;
            return (
              // Index keys are correct here: the list has no stable per-item id,
              // and removal re-renders every input from form state anyway.
              <li key={optionIndex} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    {...register(`schema.${index}.options.${optionIndex}` as FormPath)}
                    aria-label={`Option ${optionIndex + 1}`}
                    aria-invalid={Boolean(message)}
                    aria-describedby={message ? errorId : undefined}
                    placeholder={`Option ${optionIndex + 1}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      replaceOptions(options.filter((_value, position) => position !== optionIndex))
                    }
                    disabled={options.length <= MIN_OPTIONS}
                    aria-label={`Remove option ${optionIndex + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
                {message && (
                  <p id={errorId} role="alert" className="text-sm font-medium text-destructive">
                    {message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {listError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {listError}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => replaceOptions([...options, ''])}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add option
        </Button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-input"
          {...register(`schema.${index}.allow_multiple` as FormPath)}
        />
        Allow selecting more than one option
      </label>
    </div>
  );
}

function ScaleEditor({ index }: { index: number }): JSX.Element {
  const { register, formState } = useFormContext<QuestionnaireFormValues>();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Minimum" error={questionError(formState.errors, index, 'min')}>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            {...register(`schema.${index}.min` as FormPath, { valueAsNumber: true })}
            type="number"
          />
        )}
      </Field>
      <Field label="Maximum" error={questionError(formState.errors, index, 'max')}>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            {...register(`schema.${index}.max` as FormPath, { valueAsNumber: true })}
            type="number"
          />
        )}
      </Field>
      <Field
        label="Label for the low end"
        error={questionError(formState.errors, index, 'min_label')}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            {...register(`schema.${index}.min_label` as FormPath)}
            placeholder="Optional, e.g. Not at all"
          />
        )}
      </Field>
      <Field
        label="Label for the high end"
        error={questionError(formState.errors, index, 'max_label')}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            {...register(`schema.${index}.max_label` as FormPath)}
            placeholder="Optional, e.g. Very"
          />
        )}
      </Field>
    </div>
  );
}

function ShortTextEditor({ index }: { index: number }): JSX.Element {
  const { register, formState } = useFormContext<QuestionnaireFormValues>();

  return (
    <Field
      label="Maximum length"
      hint="Optional. Leave blank to allow up to 5000 characters."
      error={questionError(formState.errors, index, 'max_length')}
    >
      {(fieldProps) => (
        <Input
          {...fieldProps}
          {...register(`schema.${index}.max_length` as FormPath, {
            // An empty input must become null, not NaN. React Hook Form also
            // runs this over the field's default value, so null has to survive
            // the round trip: `Number(null)` would quietly make it 0, and 0
            // then fails validation on a question nobody has touched.
            setValueAs: (value: unknown) => {
              if (value === '' || value === null || value === undefined) return null;
              const parsed = Number(value);
              return Number.isNaN(parsed) ? null : parsed;
            },
          })}
          type="number"
          min={1}
          max={5000}
          placeholder="5000"
        />
      )}
    </Field>
  );
}
