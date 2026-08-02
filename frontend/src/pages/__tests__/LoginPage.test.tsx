/** The two-step sign-in, against a mocked API. */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import { tokenStore } from '@/api/tokens';
import { AuthProvider } from '@/hooks/useAuth';
import LoginPage from '@/pages/LoginPage';
import { createTestQueryClient, withQueryClient } from '@/test/utils';

vi.mock('@/api/endpoints', () => ({
  api: { requestOtp: vi.fn(), verifyOtp: vi.fn(), me: vi.fn() },
}));

const requestOtp = vi.mocked(api.requestOtp);
const verifyOtp = vi.mocked(api.verifyOtp);
const me = vi.mocked(api.me);

const tokens = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  token_type: 'bearer' as const,
  expires_in: 900,
};

function renderLogin() {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/app/questionnaires', element: <p>Dashboard</p> },
    ],
    { initialEntries: ['/login'] },
  );
  return render(
    withQueryClient(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
      createTestQueryClient(),
    ),
  );
}

beforeEach(() => {
  requestOtp.mockReset();
  verifyOtp.mockReset();
  me.mockReset();
  requestOtp.mockResolvedValue({ message: 'sent' });
  verifyOtp.mockResolvedValue(tokens);
  me.mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000000',
    email: 'owner@example.com',
    created_at: new Date().toISOString(),
  });
});

describe('LoginPage', () => {
  it('walks email → code → signed in', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email address/i), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));

    await waitFor(() => expect(requestOtp).toHaveBeenCalledWith('owner@example.com'));
    expect(await screen.findByLabelText(/six-digit code/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/six-digit code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify and sign in/i }));

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith('owner@example.com', '123456'));
    await waitFor(() => expect(tokenStore.getAccessToken()).toBe('access-token'));
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });

  it('validates the email before calling the API', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email address/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /send code/i }));

    expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
    expect(requestOtp).not.toHaveBeenCalled();
  });

  it('validates the code before calling the API', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email address/i), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    await screen.findByLabelText(/six-digit code/i);

    await user.type(screen.getByLabelText(/six-digit code/i), '12');
    await user.click(screen.getByRole('button', { name: /verify and sign in/i }));

    expect(await screen.findByText(/enter the code from your email/i)).toBeInTheDocument();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('shows a clear error when the code is wrong, and stays on the code step', async () => {
    const user = userEvent.setup();
    verifyOtp.mockRejectedValue(new ApiError(401, 'invalid_otp', 'Invalid or expired code'));
    renderLogin();

    await user.type(screen.getByLabelText(/email address/i), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    await screen.findByLabelText(/six-digit code/i);

    await user.type(screen.getByLabelText(/six-digit code/i), '999999');
    await user.click(screen.getByRole('button', { name: /verify and sign in/i }));

    expect(await screen.findByText(/invalid or expired code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/six-digit code/i)).toBeInTheDocument();
    expect(tokenStore.getAccessToken()).toBeNull();
  });

  it('explains a rate limit rather than showing the raw message', async () => {
    const user = userEvent.setup();
    requestOtp.mockRejectedValue(new ApiError(429, 'rate_limited', 'Too many requests.'));
    renderLogin();

    await user.type(screen.getByLabelText(/email address/i), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));

    expect(await screen.findByText(/wait a few minutes/i)).toBeInTheDocument();
  });

  it('puts the resend button on cooldown as soon as a code is sent', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email address/i), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    await screen.findByLabelText(/six-digit code/i);

    const resend = await screen.findByRole('button', { name: /resend in \d+s/i });
    expect(resend).toBeDisabled();
  });

  it('can go back and use a different email', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email address/i), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    await screen.findByLabelText(/six-digit code/i);

    await user.click(screen.getByRole('button', { name: /use a different email/i }));

    expect(await screen.findByLabelText(/email address/i)).toBeInTheDocument();
  });
});
