/**
 * Catches anything a route throws during render, so a bug shows a readable
 * page rather than a blank screen.
 */
import { Link, useRouteError } from 'react-router-dom';

import { errorMessage } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/primitives';

export function RootBoundary(): JSX.Element {
  const error = useRouteError();

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="space-y-4">
        <Alert variant="destructive" title="Something went wrong">
          <p>{errorMessage(error)}</p>
        </Alert>
        <Button asChild variant="outline">
          <Link to="/app/questionnaires">Back to safety</Link>
        </Button>
      </div>
    </main>
  );
}
