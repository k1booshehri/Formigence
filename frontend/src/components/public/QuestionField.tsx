/**
 * One question as a respondent sees it.
 *
 * Native radios, checkboxes and inputs: they are keyboard-operable and
 * announced correctly with no extra work. Each question is a `<fieldset>` with
 * a `<legend>`, so the prompt is announced with every option.
 */
import type { AnswerValue, Question } from '@/api/schemas';
import { Input, Textarea } from '@/components/ui/form-controls';
import { DEFAULT_SHORT_TEXT_MAX_LENGTH } from '@/api/schemas';

interface QuestionFieldProps {
  question: Question;
  index: number;
  value: AnswerValue | undefined;
  error: string | undefined;
  onChange: (value: AnswerValue) => void;
}

export function QuestionField({
  question,
  index,
  value,
  error,
  onChange,
}: QuestionFieldProps): JSX.Element {
  const errorId = `${question.id}-error`;
  const describedBy = error ? errorId : undefined;

  return (
    <fieldset
      className="rounded-lg border border-border bg-card p-4"
      aria-describedby={describedBy}
      aria-invalid={Boolean(error)}
    >
      <legend className="px-1 text-sm font-medium">
        <span className="text-muted-foreground">{index + 1}. </span>
        {question.prompt}
      </legend>

      <div className="mt-3">
        {question.type === 'multiple_choice' && (
          <ChoiceInput question={question} value={value} onChange={onChange} />
        )}
        {question.type === 'scale' && (
          <ScaleInput question={question} value={value} onChange={onChange} />
        )}
        {question.type === 'short_text' && (
          <TextInput question={question} value={value} onChange={onChange} />
        )}
      </div>

      {error && (
        <p id={errorId} role="alert" className="mt-2 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}

type ChoiceQuestion = Extract<Question, { type: 'multiple_choice' }>;
type ScaleQ = Extract<Question, { type: 'scale' }>;
type TextQuestion = Extract<Question, { type: 'short_text' }>;

function ChoiceInput({
  question,
  value,
  onChange,
}: {
  question: ChoiceQuestion;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
}): JSX.Element {
  if (question.allow_multiple) {
    const selected: string[] = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-2">
        {question.options.map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              name={question.id}
              value={option}
              checked={selected.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option]
                    : selected.filter((item) => item !== option),
                )
              }
            />
            {option}
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {question.options.map((option) => (
        <label key={option} className="flex cursor-pointer items-center gap-3 text-sm">
          <input
            type="radio"
            className="h-4 w-4 border-input"
            name={question.id}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          {option}
        </label>
      ))}
    </div>
  );
}

function ScaleInput({
  question,
  value,
  onChange,
}: {
  question: ScaleQ;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
}): JSX.Element {
  const points: number[] = [];
  for (let point = question.min; point <= question.max; point += 1) points.push(point);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {points.map((point) => (
          <label
            key={point}
            className="flex min-w-10 cursor-pointer flex-col items-center gap-1 rounded-md border border-input px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground"
          >
            <input
              type="radio"
              className="sr-only"
              name={question.id}
              value={point}
              checked={value === point}
              onChange={() => onChange(point)}
            />
            {point}
          </label>
        ))}
      </div>
      {(question.min_label || question.max_label) && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{question.min_label ?? ''}</span>
          <span>{question.max_label ?? ''}</span>
        </div>
      )}
    </div>
  );
}

function TextInput({
  question,
  value,
  onChange,
}: {
  question: TextQuestion;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
}): JSX.Element {
  const limit = question.max_length ?? DEFAULT_SHORT_TEXT_MAX_LENGTH;
  const text = typeof value === 'string' ? value : '';
  const isShort = limit <= 120;

  const shared = {
    // `name` also lets the page move focus to the first invalid question.
    name: question.id,
    value: text,
    maxLength: limit,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    'aria-label': question.prompt,
  };

  return (
    <div className="space-y-1">
      {isShort ? <Input {...shared} /> : <Textarea {...shared} rows={4} />}
      <p className="text-right text-xs text-muted-foreground">
        {text.length} / {limit}
      </p>
    </div>
  );
}
