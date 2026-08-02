import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { errorMessage } from '@/api/errors';
import type { Questionnaire } from '@/api/schemas';
import { QueryState } from '@/components/QueryState';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardContent } from '@/components/ui/primitives';
import { useDeleteQuestionnaire, useQuestionnaires } from '@/hooks/useQuestionnaires';

export default function QuestionnairesPage(): JSX.Element {
  const questionnaires = useQuestionnaires();
  const deleteQuestionnaire = useDeleteQuestionnaire();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Questionnaires</h1>
          <p className="text-sm text-muted-foreground">
            Build an assessment, publish it, and share the link.
          </p>
        </div>
        <Button asChild>
          <Link to="/app/questionnaires/new">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New questionnaire
          </Link>
        </Button>
      </div>

      {deleteQuestionnaire.isError && (
        <Alert variant="destructive" title="Could not delete">
          <p>{errorMessage(deleteQuestionnaire.error)}</p>
        </Alert>
      )}

      <QueryState
        query={questionnaires}
        errorTitle="Could not load your questionnaires"
        isEmpty={(items) => items.length === 0}
        empty={<EmptyState />}
      >
        {(items) => (
          <ul className="space-y-3">
            {items.map((questionnaire) => (
              <li key={questionnaire.id}>
                <QuestionnaireRow
                  questionnaire={questionnaire}
                  onDelete={() => deleteQuestionnaire.mutate(questionnaire.id)}
                  isDeleting={
                    deleteQuestionnaire.isPending &&
                    deleteQuestionnaire.variables === questionnaire.id
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="font-medium">No questionnaires yet</p>
          <p className="text-sm text-muted-foreground">
            Create your first assessment to start collecting responses.
          </p>
        </div>
        <Button asChild>
          <Link to="/app/questionnaires/new">Create a questionnaire</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

interface RowProps {
  questionnaire: Questionnaire;
  onDelete: () => void;
  isDeleting: boolean;
}

function QuestionnaireRow({ questionnaire, onDelete, isDeleting }: RowProps): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const questionCount = questionnaire.schema.length;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              to={`/app/questionnaires/${questionnaire.id}/edit`}
              className="truncate font-medium underline-offset-4 hover:underline"
            >
              {questionnaire.title}
            </Link>
            {questionnaire.is_published ? (
              <Badge variant="success">Published</Badge>
            ) : (
              <Badge variant="secondary">Draft</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {questionCount} {questionCount === 1 ? 'question' : 'questions'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/app/questionnaires/${questionnaire.id}/responses`}>Responses</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`/app/questionnaires/${questionnaire.id}/edit`}>Edit</Link>
          </Button>
          {confirming ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={onDelete}
                loading={isDeleting}
                autoFocus
              >
                Confirm delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
