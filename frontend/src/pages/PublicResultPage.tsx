/**
 * What the respondent sees after submitting: a friendly wait, then the
 * recommendation.
 *
 * The response id in the URL is the only credential — the backend returns just
 * `{status, result}` for it, never the answers or the owner's guide.
 */
import { CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { useParams } from 'react-router-dom';

import { errorMessage } from '@/api/errors';
import type { Confidence, Recommendation } from '@/api/schemas';
import { Alert, Badge, Card, CardContent } from '@/components/ui/primitives';
import { useResponsePolling } from '@/hooks/useResponsePolling';

const CONFIDENCE_VARIANT: Record<Confidence, 'secondary' | 'warning' | 'success'> = {
  low: 'secondary',
  medium: 'warning',
  high: 'success',
};

export default function PublicResultPage(): JSX.Element {
  const { responseId } = useParams<{ responseId: string }>();
  const polling = useResponsePolling(responseId);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Your recommendation</h1>
          <p className="text-sm text-muted-foreground">
            Thanks for your answers. You can close this page — the link will keep working.
          </p>
        </header>

        {polling.phase === 'polling' && <Analyzing />}
        {polling.phase === 'timeout' && <TakingLonger />}
        {polling.phase === 'failed' && <Failed />}
        {polling.phase === 'error' && (
          <Alert variant="destructive" title="Could not load your result">
            <p>{errorMessage(polling.error)}</p>
          </Alert>
        )}
        {polling.phase === 'complete' &&
          (polling.result ? <Result result={polling.result} /> : <Failed />)}
      </div>
    </main>
  );
}

function Analyzing(): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-10" aria-live="polite">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="font-medium">Analyzing your answers…</p>
          <p className="text-sm text-muted-foreground">This usually takes a few seconds.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TakingLonger(): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-10" aria-live="polite">
        <Clock className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium">This is taking longer than expected</p>
          <p className="text-sm text-muted-foreground">
            Your answers were received. Keep this link and check back in a few minutes — your
            recommendation will appear here when it is ready.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Failed(): JSX.Element {
  return (
    <Alert variant="destructive" title="We could not complete the analysis">
      <p>
        Sorry — something went wrong while analyzing your answers, and we could not produce a
        recommendation. Your responses were saved, so whoever sent you this can follow up.
      </p>
    </Alert>
  );
}

function Result({ result }: { result: Recommendation }): JSX.Element {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            <h2 className="font-semibold">Recommendation</h2>
            <Badge variant={CONFIDENCE_VARIANT[result.confidence]} className="ml-auto">
              {result.confidence} confidence
            </Badge>
          </div>
          <p className="whitespace-pre-wrap leading-relaxed">{result.recommendation}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <h2 className="font-semibold">Why</h2>
          <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
            {result.reasoning}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
