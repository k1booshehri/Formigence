/** The respondent form: validation, submission, and the not-found path. */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { PublicQuestionnaire } from '@/api/schemas';
import PublicQuestionnairePage from '@/pages/PublicQuestionnairePage';
import { createTestQueryClient, withQueryClient } from '@/test/utils';

vi.mock('@/api/endpoints', () => ({
  api: { getPublicQuestionnaire: vi.fn(), submitResponse: vi.fn() },
}));

const getPublicQuestionnaire = vi.mocked(api.getPublicQuestionnaire);
const submitResponse = vi.mocked(api.submitResponse);

const questionnaire: PublicQuestionnaire = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Growth readiness check',
  description: 'A short assessment.',
  public_slug: 'growth-check-abcd1234',
  schema: [
    {
      id: 'q1',
      type: 'multiple_choice',
      prompt: 'Which channels do you sell through?',
      options: ['Retail', 'Online'],
      allow_multiple: true,
    },
    { id: 'q2', type: 'scale', prompt: 'Confidence in pricing?', min: 1, max: 3 },
    { id: 'q3', type: 'short_text', prompt: 'Biggest bottleneck?', max_length: 500 },
  ],
};

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/q/:slug', element: <PublicQuestionnairePage /> },
      { path: '/q/:slug/result/:responseId', element: <p>Result page</p> },
    ],
    { initialEntries: ['/q/growth-check-abcd1234'] },
  );
  return render(withQueryClient(<RouterProvider router={router} />, createTestQueryClient()));
}

beforeEach(() => {
  getPublicQuestionnaire.mockReset();
  submitResponse.mockReset();
  getPublicQuestionnaire.mockResolvedValue(questionnaire);
  submitResponse.mockResolvedValue({
    response_id: '44444444-4444-4444-8444-444444444444',
    status: 'pending',
  });
});

describe('PublicQuestionnairePage', () => {
  it('renders every question', async () => {
    renderPage();

    expect(await screen.findByText('Growth readiness check')).toBeInTheDocument();
    expect(screen.getByText(/which channels do you sell through/i)).toBeInTheDocument();
    expect(screen.getByText(/confidence in pricing/i)).toBeInTheDocument();
    expect(screen.getByText(/biggest bottleneck/i)).toBeInTheDocument();
  });

  it('blocks submission until every question is answered', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Growth readiness check');

    await user.click(screen.getByRole('button', { name: /submit answers/i }));

    expect(await screen.findByText(/3 questions need attention/i)).toBeInTheDocument();
    expect(submitResponse).not.toHaveBeenCalled();
  });

  it('submits once everything is answered and moves to the result page', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Growth readiness check');

    await user.click(screen.getByRole('checkbox', { name: 'Online' }));
    await user.click(screen.getByRole('radio', { name: '2' }));
    await user.type(screen.getByRole('textbox'), 'Hiring is slow.');

    await user.click(screen.getByRole('button', { name: /submit answers/i }));

    await waitFor(() => expect(submitResponse).toHaveBeenCalledTimes(1));
    expect(submitResponse).toHaveBeenCalledWith('growth-check-abcd1234', {
      q1: ['Online'],
      q2: 2,
      q3: 'Hiring is slow.',
    });
    expect(await screen.findByText('Result page')).toBeInTheDocument();
  });

  it('clears a question error once it is answered', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Growth readiness check');

    await user.click(screen.getByRole('button', { name: /submit answers/i }));
    expect(await screen.findByText(/3 questions need attention/i)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Online' }));

    expect(await screen.findByText(/2 questions need attention/i)).toBeInTheDocument();
  });

  it('maps a backend 422 back onto the individual questions', async () => {
    const user = userEvent.setup();
    submitResponse.mockRejectedValue(
      new ApiError(422, 'invalid_answers', 'Answers do not match the questionnaire', [
        { question_id: 'q2', message: 'must be between 1 and 3' },
      ]),
    );
    renderPage();
    await screen.findByText('Growth readiness check');

    await user.click(screen.getByRole('checkbox', { name: 'Online' }));
    await user.click(screen.getByRole('radio', { name: '2' }));
    await user.type(screen.getByRole('textbox'), 'Hiring is slow.');
    await user.click(screen.getByRole('button', { name: /submit answers/i }));

    expect(await screen.findByText(/must be between 1 and 3/i)).toBeInTheDocument();
  });

  it('explains a rate limit', async () => {
    const user = userEvent.setup();
    submitResponse.mockRejectedValue(new ApiError(429, 'rate_limited', 'Too many requests.'));
    renderPage();
    await screen.findByText('Growth readiness check');

    await user.click(screen.getByRole('checkbox', { name: 'Online' }));
    await user.click(screen.getByRole('radio', { name: '2' }));
    await user.type(screen.getByRole('textbox'), 'Hiring is slow.');
    await user.click(screen.getByRole('button', { name: /submit answers/i }));

    expect(await screen.findByText(/too many submissions/i)).toBeInTheDocument();
  });

  it('shows a clean not-found page for an unknown or unpublished slug', async () => {
    getPublicQuestionnaire.mockRejectedValue(
      new ApiError(404, 'questionnaire_not_found', 'Questionnaire not found'),
    );
    renderPage();

    expect(await screen.findByText(/this questionnaire is not available/i)).toBeInTheDocument();
  });

  it('shows an error state when loading fails for another reason', async () => {
    getPublicQuestionnaire.mockRejectedValue(new ApiError(500, 'internal_error', 'Server error'));
    renderPage();

    expect(await screen.findByText(/could not load this questionnaire/i)).toBeInTheDocument();
  });
});
