/**
 * The owner's view of collected responses: a paginated list, with one response
 * expanded into answers plus the full AI result.
 */
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { AnswerValue, Confidence, Question, ResponseStatus } from '@/api/schemas';
import { QueryState } from '@/components/QueryState';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent } from '@/components/ui/primitives';
import { useQuestionnaire } from '@/hooks/useQuestionnaires';
import { RESPONSES_PAGE_SIZE, useResponseDetail, useResponses } from '@/hooks/useResponses';

const STATUS_LABEL: Record<ResponseStatus, string> = {
  pending: 'Queued',
  processing: 'Analyzing',
  complete: 'Complete',
  failed: 'Failed',
};

const STATUS_VARIANT: Record<ResponseStatus, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  pending: 'secondary',
  processing: 'warning',
  complete: 'success',
  failed: 'destructive',
};

const CONFIDENCE_VARIANT: Record<Confidence, 'secondary' | 'warning' | 'success'> = {
  low: 'secondary',
  medium: 'warning',
  high: 'success',
};

export default function ResponsesPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const questionnaire = useQuestionnaire(id);
  const responses = useResponses(id, offset);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/app/questionnaires">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Responses</h1>
          <p className="text-sm text-muted-foreground">
            {questionnaire.data?.title ?? 'Loading…'}
          </p>
        </div>
      </div>

      <QueryState
        query={responses}
        errorTitle="Could not load responses"
        isEmpty={(page) => page.total === 0}
        empty={<EmptyState published={questionnaire.data?.is_published ?? false} />}
      >
        {(page) => (
          <div className="space-y-4">
            <ul className="space-y-2">
              {page.items.map((item) => {
                const isSelected = selectedId === item.id;
                return (
                  <li key={item.id}>
                    <Card>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <Badge variant={STATUS_VARIANT[item.status]}>
                            {STATUS_LABEL[item.status]}
                          </Badge>
                          <time
                            dateTime={item.submitted_at}
                            className="text-sm text-muted-foreground"
                          >
                            {formatDate(item.submitted_at)}
                          </time>
                          {item.confidence && (
                            <Badge variant={CONFIDENCE_VARIANT[item.confidence]}>
                              {item.confidence} confidence
                            </Badge>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="ml-auto"
                            aria-expanded={isSelected}
                            onClick={() => setSelectedId(isSelected ? null : item.id)}
                          >
                            {isSelected ? 'Hide detail' : 'View detail'}
                          </Button>
                        </div>

                        <p className="text-sm text-muted-foreground">
                          {item.recommendation_summary ?? 'No recommendation yet.'}
                        </p>

                        {isSelected && id && (
                          <ResponseDetailPanel
                            questionnaireId={id}
                            responseId={item.id}
                            questions={questionnaire.data?.schema ?? []}
                          />
                        )}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>

            <Pagination
              total={page.total}
              offset={page.offset}
              limit={page.limit}
              onChange={(next) => {
                setSelectedId(null);
                setOffset(next);
              }}
            />
          </div>
        )}
      </QueryState>
    </div>
  );
}

function EmptyState({ published }: { published: boolean }): JSX.Element {
  return (
    <Card>
      <CardContent className="space-y-2 py-12 text-center">
        <p className="font-medium">No responses yet</p>
        <p className="text-sm text-muted-foreground">
          {published
            ? 'Share the public link to start collecting answers.'
            : 'Publish this questionnaire to start collecting answers.'}
        </p>
      </CardContent>
    </Card>
  );
}

interface DetailProps {
  questionnaireId: string;
  responseId: string;
  questions: Question[];
}

function ResponseDetailPanel({
  questionnaireId,
  responseId,
  questions,
}: DetailProps): JSX.Element {
  const detail = useResponseDetail(questionnaireId, responseId);

  return (
    <div className="rounded-md border border-border bg-muted/30 p-4">
      <QueryState query={detail} errorTitle="Could not load this response">
        {(data) => (
          <div className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Answers</h3>
              <dl className="space-y-2">
                {questions.map((question) => (
                  <div key={question.id}>
                    <dt className="text-sm text-muted-foreground">{question.prompt}</dt>
                    <dd className="text-sm">
                      {formatAnswer(data.answers[question.id] as AnswerValue | undefined)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            {data.ai_result ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Recommendation</h3>
                <p className="whitespace-pre-wrap text-sm">{data.ai_result.recommendation}</p>
                <h3 className="text-sm font-semibold">Reasoning</h3>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {data.ai_result.reasoning}
                </p>
              </section>
            ) : (
              <p className="text-sm text-muted-foreground">
                {data.status === 'failed'
                  ? 'Analysis failed for this response.'
                  : 'Analysis has not finished yet.'}
              </p>
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}

interface PaginationProps {
  total: number;
  offset: number;
  limit: number;
  onChange: (offset: number) => void;
}

function Pagination({ total, offset, limit, onChange }: PaginationProps): JSX.Element | null {
  if (total <= limit) return null;
  const first = offset + 1;
  const last = Math.min(offset + limit, total);

  return (
    <nav className="flex items-center justify-between" aria-label="Pagination">
      <p className="text-sm text-muted-foreground">
        {first}–{last} of {total}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - RESPONSES_PAGE_SIZE))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={last >= total}
          onClick={() => onChange(offset + RESPONSES_PAGE_SIZE)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatAnswer(value: AnswerValue | undefined): string {
  if (value === undefined) return '—';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}
