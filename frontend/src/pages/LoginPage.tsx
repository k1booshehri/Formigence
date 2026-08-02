/**
 * Two-step passwordless sign-in: email, then the code from that email.
 *
 * `POST /auth/request-otp` always returns 200 whether or not the address is
 * registered, so this page never tells the user which — it just moves to the
 * code step.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { api } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/errors';
import { emailFormSchema, otpFormSchema, type EmailFormValues, type OtpFormValues } from '@/api/schemas';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/useAuth';
import { useCooldown } from '@/hooks/useCooldown';

const RESEND_COOLDOWN_SECONDS = 30;

export default function LoginPage(): JSX.Element {
  const { isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? '/app/questionnaires';

  if (isAuthenticated) return <Navigate to={from} replace />;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to Formigence</CardTitle>
          <CardDescription>
            {email
              ? `We sent a code to ${email}.`
              : 'We will email you a one-time code — no password needed.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {email === null ? (
            <EmailStep onSent={setEmail} />
          ) : (
            <CodeStep
              email={email}
              onBack={() => setEmail(null)}
              onSignedIn={() => navigate(from, { replace: true })}
              signIn={signIn}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function EmailStep({ onSent }: { onSent: (email: string) => void }): JSX.Element {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmailFormValues>({
    resolver: zodResolver(emailFormSchema),
    defaultValues: { email: '' },
  });

  const requestOtp = useMutation({
    mutationFn: (values: EmailFormValues) => api.requestOtp(values.email),
    onSuccess: (_data, values) => onSent(values.email),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit((values) => requestOtp.mutate(values))}
      noValidate
    >
      <Field label="Email address" error={errors.email?.message}>
        {(fieldProps) => (
          <Input
            {...fieldProps}
            {...register('email')}
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
          />
        )}
      </Field>

      {requestOtp.isError && (
        <Alert variant="destructive" title="Could not send the code">
          <p>{signInErrorMessage(requestOtp.error)}</p>
        </Alert>
      )}

      <Button type="submit" className="w-full" loading={requestOtp.isPending}>
        {requestOtp.isPending ? 'Sending…' : 'Send code'}
      </Button>
    </form>
  );
}

interface CodeStepProps {
  email: string;
  onBack: () => void;
  onSignedIn: () => void;
  signIn: (email: string, code: string) => Promise<void>;
}

function CodeStep({ email, onBack, onSignedIn, signIn }: CodeStepProps): JSX.Element {
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS);
  const startCooldown = cooldown.start;
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<OtpFormValues>({
    resolver: zodResolver(otpFormSchema),
    defaultValues: { code: '' },
  });

  // A code was just sent, so the resend button starts on cooldown.
  useEffect(() => {
    startCooldown();
    setFocus('code');
  }, [startCooldown, setFocus]);

  const verify = useMutation({
    mutationFn: (values: OtpFormValues) => signIn(email, values.code),
    onSuccess: onSignedIn,
  });

  const resend = useMutation({
    mutationFn: () => api.requestOtp(email),
    onSuccess: () => {
      cooldown.start();
      codeInputRef.current?.focus();
    },
  });

  const codeField = register('code');

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit((values) => verify.mutate(values))}
      noValidate
    >
      <Field
        label="Six-digit code"
        hint="Check your email. In development the code is printed to the backend console."
        error={errors.code?.message}
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            {...codeField}
            ref={(element) => {
              codeField.ref(element);
              codeInputRef.current = element;
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
          />
        )}
      </Field>

      {verify.isError && (
        <Alert variant="destructive" title="That did not work">
          <p>{signInErrorMessage(verify.error)}</p>
        </Alert>
      )}
      {resend.isError && (
        <Alert variant="destructive" title="Could not resend">
          <p>{signInErrorMessage(resend.error)}</p>
        </Alert>
      )}

      <Button type="submit" className="w-full" loading={verify.isPending}>
        {verify.isPending ? 'Verifying…' : 'Verify and sign in'}
      </Button>

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Use a different email
        </button>
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => resend.mutate()}
          disabled={cooldown.isCoolingDown || resend.isPending}
        >
          {cooldown.isCoolingDown ? `Resend in ${cooldown.secondsLeft}s` : 'Resend code'}
        </Button>
      </div>
    </form>
  );
}

/** Rate limits are the one auth failure worth explaining specifically. */
function signInErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.isRateLimited) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  return errorMessage(error);
}
