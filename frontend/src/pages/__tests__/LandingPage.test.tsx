/** The public front door: what it says, and where it sends people. */
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/endpoints';
import { tokenStore } from '@/api/tokens';
import { AuthProvider } from '@/hooks/useAuth';
import LandingPage from '@/pages/LandingPage';
import { createTestQueryClient, withQueryClient } from '@/test/utils';

vi.mock('@/api/endpoints', () => ({
  api: { me: vi.fn() },
}));

function renderLanding() {
  const router = createMemoryRouter([{ path: '/', element: <LandingPage /> }], {
    initialEntries: ['/'],
  });
  return render(
    withQueryClient(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
      createTestQueryClient(),
    ),
  );
}

afterEach(() => {
  tokenStore.clear();
});

describe('LandingPage', () => {
  it('explains the product before asking for anything', () => {
    renderLanding();

    expect(
      screen.getByRole('heading', { level: 1, name: /turn a questionnaire into a recommendation/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /how it works/i })).toBeInTheDocument();
    expect(screen.getByText(/never leaves the server/i)).toBeInTheDocument();
  });

  it('sends a visitor without a session to sign in', () => {
    renderLanding();

    for (const link of screen.getAllByRole('link', { name: /get started|sign in/i })) {
      expect(link).toHaveAttribute('href', '/login');
    }
    expect(screen.getByText(/no password to set up/i)).toBeInTheDocument();
  });

  it('sends a signed-in visitor to their questionnaires instead', () => {
    vi.mocked(api.me).mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      email: 'owner@example.com',
      created_at: new Date().toISOString(),
    });
    tokenStore.save({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'bearer',
      expires_in: 900,
    });

    renderLanding();

    for (const link of screen.getAllByRole('link', { name: /questionnaires|open the app/i })) {
      expect(link).toHaveAttribute('href', '/app/questionnaires');
    }
    // The sign-up nudge is for visitors who need it, not for people already in.
    expect(screen.queryByText(/no password to set up/i)).not.toBeInTheDocument();
  });
});
