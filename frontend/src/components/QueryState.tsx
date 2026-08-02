/**
 * The loading / error / empty envelope every server-backed view uses.
 *
 * Centralising it is what makes "no blank screens" enforceable rather than a
 * thing each page has to remember.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ApiError, errorMessage } from '@/api/errors';
import { Alert, Skeleton } from '@/components/ui/primitives';

interface QueryStateProps<TData> {
  query: UseQueryResult<TData>;
  children: (data: TData) => ReactNode;
  /** Rendered when the query resolves but `isEmpty` says there's nothing. */
  empty?: ReactNode;
  isEmpty?: (data: TData) => boolean;
  loading?: ReactNode;
  /** Rendered instead of the generic error state on a 404. */
  notFound?: ReactNode;
  errorTitle?: string;
}

export function DefaultLoading(): JSX.Element {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/**
 * Returns `JSX.Element` rather than `ReactNode`: a component used as `<QueryState/>`
 * has to be a valid JSX element type, and `ReactNode` admits `undefined`, which
 * is not. Hence the fragments around the render-prop results.
 */
export function QueryState<TData>({
  query,
  children,
  empty,
  isEmpty,
  loading,
  notFound,
  errorTitle = 'Could not load this',
}: QueryStateProps<TData>): JSX.Element {
  if (query.isPending) return <>{loading ?? <DefaultLoading />}</>;

  if (query.isError) {
    if (notFound && query.error instanceof ApiError && query.error.isNotFound) {
      return <>{notFound}</>;
    }
    return (
      <Alert variant="destructive" title={errorTitle}>
        <p>{errorMessage(query.error)}</p>
      </Alert>
    );
  }

  if (isEmpty && empty && isEmpty(query.data)) return <>{empty}</>;
  return <>{children(query.data)}</>;
}
