/**
 * Polling transitions.
 *
 * Real timers with very small intervals rather than fake ones: TanStack Query
 * schedules its own refetches, and driving that with fake timers is far more
 * brittle than simply making the intervals tiny.
 */
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { ResponseStatusOut } from '@/api/schemas';
import { useResponsePolling } from '@/hooks/useResponsePolling';
import { createTestQueryClient, withQueryClient } from '@/test/utils';

vi.mock('@/api/endpoints', () => ({
  api: { getResponseStatus: vi.fn() },
}));

const getResponseStatus = vi.mocked(api.getResponseStatus);

const recommendation = {
  recommendation: 'Raise prices by 10%.',
  reasoning: 'Demand is strong.',
  confidence: 'medium' as const,
};

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return withQueryClient(children, createTestQueryClient());
}

function pending(): ResponseStatusOut {
  return { status: 'pending', result: null };
}

beforeEach(() => {
  getResponseStatus.mockReset();
});

describe('useResponsePolling', () => {
  it('moves from pending to complete and stops polling', async () => {
    getResponseStatus
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce({ status: 'processing', result: null })
      .mockResolvedValue({ status: 'complete', result: recommendation });

    const { result } = renderHook(
      () => useResponsePolling('response-1', { intervalMs: 10, timeoutMs: 5_000 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.phase).toBe('polling'));
    await waitFor(() => expect(result.current.phase).toBe('complete'));

    expect(result.current.result).toEqual(recommendation);
    expect(result.current.isSettled).toBe(true);

    // Polling has stopped: no further calls after settling.
    const callsWhenSettled = getResponseStatus.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(getResponseStatus.mock.calls.length).toBe(callsWhenSettled);
  });

  it('reports failed analysis as a terminal phase', async () => {
    getResponseStatus.mockResolvedValue({ status: 'failed', result: null });

    const { result } = renderHook(
      () => useResponsePolling('response-2', { intervalMs: 10, timeoutMs: 5_000 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.result).toBeNull();
    expect(result.current.isSettled).toBe(true);
  });

  it('gives up with a timeout phase when analysis never settles', async () => {
    getResponseStatus.mockResolvedValue(pending());

    const { result } = renderHook(
      () => useResponsePolling('response-3', { intervalMs: 10, timeoutMs: 30 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.phase).toBe('timeout'));
    expect(result.current.isSettled).toBe(false);

    // It stops asking once it has given up.
    const callsAtTimeout = getResponseStatus.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(getResponseStatus.mock.calls.length).toBeLessThanOrEqual(callsAtTimeout + 1);
  });

  it('surfaces an unknown response id as an error without retrying', async () => {
    getResponseStatus.mockRejectedValue(new ApiError(404, 'response_not_found', 'Not found'));

    const { result } = renderHook(
      () => useResponsePolling('missing', { intervalMs: 10, timeoutMs: 5_000 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(getResponseStatus).toHaveBeenCalledTimes(1);
  });

  it('does not poll without a response id', () => {
    renderHook(() => useResponsePolling(undefined), { wrapper });
    expect(getResponseStatus).not.toHaveBeenCalled();
  });
});
