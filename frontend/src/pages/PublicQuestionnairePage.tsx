/** Read-only view of a published questionnaire. No auth, no analysis guide. */

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { api } from '../lib/api';
import type { Question } from '../lib/types';

function QuestionCard({ question }: { question: Question }) {
  return (
    <li className="rounded border border-slate-200 bg-white p-4">
      <p className="font-medium">{question.prompt}</p>
      {question.type === 'multiple_choice' && (
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
          {question.options.map((option) => (
            <li key={option}>{option}</li>
          ))}
        </ul>
      )}
      {question.type === 'scale' && (
        <p className="mt-2 text-sm text-slate-600">
          {question.min_label ?? question.min} &rarr; {question.max_label ?? question.max}
        </p>
      )}
      {question.type === 'short_text' && (
        <p className="mt-2 text-sm text-slate-600">
          Free text{question.max_length ? ` (max ${question.max_length} characters)` : ''}
        </p>
      )}
    </li>
  );
}

export default function PublicQuestionnairePage() {
  const { slug } = useParams<{ slug: string }>();
  const questionnaire = useQuery({
    queryKey: ['public-questionnaire', slug],
    queryFn: () => api.getPublicQuestionnaire(slug as string),
    enabled: Boolean(slug),
  });

  if (questionnaire.isPending) return <p className="text-slate-600">Loading...</p>;
  if (questionnaire.isError) return <p className="text-slate-600">Questionnaire not found.</p>;

  return (
    <article className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{questionnaire.data.title}</h1>
        {questionnaire.data.description && (
          <p className="mt-1 text-slate-600">{questionnaire.data.description}</p>
        )}
      </header>
      <ul className="space-y-3">
        {questionnaire.data.schema.map((question) => (
          <QuestionCard key={question.id} question={question} />
        ))}
      </ul>
      <p className="text-sm text-slate-500">
        Answer submission is not part of this milestone.
      </p>
    </article>
  );
}
