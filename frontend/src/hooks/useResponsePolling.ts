/**
 * Poll a submitted response until analysis settles.
 *
 * Analysis is a background job, so the respondent watches this. It polls every
 * two seconds, stops the moment the status is terminal, and gives up after two
 * minutes with a distinct `timeout` phase rather than spinning forever.
 *
 * The intervals are parameters so tests can drive them with fake timers.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { Recommendation, ResponseStatus } from '@/api/schemas';

export const POLL_INTERVAL_MS = 2_000;
export const POLL_TIMEOUT_MS = 120_000;

export type PollPhase = 'polling' | 'complete' | 'failed' | 'timeout' | 'error';

export interface ResponsePollingResult {
  phase: PollPhase;
  status: ResponseStatus | undefined;
  result: Recommendation | null;
  error: unknown;
  /** True once analysis reached a terminal state; polling has stopped. */
  isSettled: boolean;
}

interface Options {
  intervalMs?: number;
  timeoutMs?: number;
}

function isTerminal(status: ResponseStatus | undefined): boolean {
  return status === 'complete' || status === 'failed';
}

export function useResponsePolling(
  responseId: string | undefined,
  { intervalMs = POLL_INTERVAL_MS, timeoutMs = POLL_TIMEOUT_MS }: Options = {},
): ResponsePollingResult {
  const startedAtRef = useRef(Date.now());
  const [timedOut, setTimedOut] = useState(false);

  // Restart the clock if we begin watching a different response.
  useEffect(() => {
    startedAtRef.current = Date.now();
    setTimedOut(false);
  }, [responseId]);

  const query = useQuery({
    queryKey: ['public-response', responseId],
    queryFn: ({ signal }) => api.getResponseStatus(responseId as string, signal),
    enabled: Boolean(responseId),
    refetchInterval: (query) => {
      if (isTerminal(query.state.data?.status)) return false;
      if (Date.now() - startedAtRef.current >= timeoutMs) return false;
      return intervalMs;
    },
    retry: (failureCount, error) => {
      // A bad or unknown id will never resolve.
      if (error instanceof ApiError && error.isNotFound) return false;
      return failureCount < 2;
    },
  });

  const status = query.data?.status;
  const settled = isTerminal(status);

  useEffect(() => {
    if (settled || !responseId) return;
    const elapsed = Date.now() - startedAtRef.current;
    const remaining = Math.max(0, timeoutMs - elapsed);
    const timer = setTimeout(() => setTimedOut(true), remaining);
    return () => clearTimeout(timer);
  }, [settled, responseId, timeoutMs]);

  let phase: PollPhase = 'polling';
  if (status === 'complete') phase = 'complete';
  else if (status === 'failed') phase = 'failed';
  else if (query.isError) phase = 'error';
  else if (timedOut) phase = 'timeout';

  return {
    phase,
    status,
    result: query.data?.result ?? null,
    error: query.error,
    isSettled: settled,
  };
}
