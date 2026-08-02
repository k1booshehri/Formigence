import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

export default function NotFoundPage(): JSX.Element {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted-foreground">
        The page you were looking for does not exist.
      </p>
      <Button asChild className="mt-6">
        <Link to="/app/questionnaires">Go to your questionnaires</Link>
      </Button>
    </main>
  );
}
