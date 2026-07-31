/**
 * Minimal proof that the API client works end to end:
 * health check -> request OTP -> verify OTP -> authenticated /me + questionnaire list.
 *
 * The dev backend logs the OTP to its console; paste it into the second step.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiError, api, tokenStore } from '../lib/api';

function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError ? `${error.code}: ${error.message}` : String(error);
  return <p className="mt-2 text-sm text-red-600">{message}</p>;
}

export default function SignInPage() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [signedIn, setSignedIn] = useState(() => tokenStore.access !== null);

  const health = useQuery({ queryKey: ['health'], queryFn: api.health });

  const requestOtp = useMutation({
    mutationFn: () => api.requestOtp(email),
    onSuccess: () => setCodeSent(true),
  });

  const verifyOtp = useMutation({
    mutationFn: () => api.verifyOtp(email, code),
    onSuccess: () => {
      setSignedIn(true);
      void queryClient.invalidateQueries();
    },
  });

  const me = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: signedIn });
  const questionnaires = useQuery({
    queryKey: ['questionnaires'],
    queryFn: api.listQuestionnaires,
    enabled: signedIn,
  });

  function signOut() {
    tokenStore.clear();
    setSignedIn(false);
    setCodeSent(false);
    setCode('');
    queryClient.clear();
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-xl font-semibold">API connectivity</h1>
        <p className="mt-1 text-sm text-slate-600">
          {health.isPending && 'Checking...'}
          {health.isError && 'Backend unreachable.'}
          {health.data && `Backend is ${health.data.status} (${health.data.environment}).`}
        </p>
        <ErrorNote error={health.error} />
      </section>

      {!signedIn && (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="font-semibold">Sign in</h2>

          <label className="mt-4 block text-sm font-medium" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            placeholder="you@example.com"
          />
          <button
            type="button"
            onClick={() => requestOtp.mutate()}
            disabled={!email || requestOtp.isPending}
            className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            {requestOtp.isPending ? 'Sending...' : 'Send code'}
          </button>
          <ErrorNote error={requestOtp.error} />

          {codeSent && (
            <>
              <p className="mt-4 text-sm text-slate-600">
                Check the backend console for the code.
              </p>
              <label className="mt-2 block text-sm font-medium" htmlFor="code">
                Code
              </label>
              <input
                id="code"
                inputMode="numeric"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                placeholder="123456"
              />
              <button
                type="button"
                onClick={() => verifyOtp.mutate()}
                disabled={!code || verifyOtp.isPending}
                className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40"
              >
                {verifyOtp.isPending ? 'Verifying...' : 'Verify'}
              </button>
              <ErrorNote error={verifyOtp.error} />
            </>
          )}
        </section>
      )}

      {signedIn && (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Signed in as {me.data?.email ?? '...'}</h2>
            <button
              type="button"
              onClick={signOut}
              className="text-sm text-slate-500 underline"
            >
              Sign out
            </button>
          </div>
          <ErrorNote error={me.error} />

          <h3 className="mt-6 text-sm font-medium uppercase tracking-wide text-slate-500">
            Your questionnaires
          </h3>
          {questionnaires.isPending && <p className="mt-2 text-sm text-slate-600">Loading...</p>}
          {questionnaires.data?.length === 0 && (
            <p className="mt-2 text-sm text-slate-600">None yet.</p>
          )}
          <ul className="mt-2 space-y-2">
            {questionnaires.data?.map((questionnaire) => (
              <li key={questionnaire.id} className="rounded border border-slate-200 px-3 py-2">
                <span className="font-medium">{questionnaire.title}</span>
                <span className="ml-2 text-sm text-slate-500">
                  {questionnaire.is_published ? `/q/${questionnaire.public_slug}` : 'draft'}
                </span>
              </li>
            ))}
          </ul>
          <ErrorNote error={questionnaires.error} />
        </section>
      )}
    </div>
  );
}
