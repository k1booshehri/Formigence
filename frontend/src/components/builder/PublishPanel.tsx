/**
 * Publish state and the shareable link.
 *
 * Publishing allocates the slug server-side if there isn't one, so the URL only
 * exists after the first publish. Unpublishing keeps the slug but makes the
 * public route 404 again.
 */
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';

import { errorMessage } from '@/api/errors';
import type { Questionnaire } from '@/api/schemas';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { usePublishQuestionnaire } from '@/hooks/useQuestionnaires';

export function publicUrlFor(slug: string): string {
  return `${window.location.origin}/q/${slug}`;
}

interface PublishPanelProps {
  questionnaire: Questionnaire;
  /** Unsaved edits would not be reflected in what respondents see. */
  disabled?: boolean;
}

export function PublishPanel({ questionnaire, disabled = false }: PublishPanelProps): JSX.Element {
  const publish = usePublishQuestionnaire(questionnaire.id);
  const { is_published: isPublished, public_slug: slug } = questionnaire;

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <CardTitle>Sharing</CardTitle>
        {isPublished ? <Badge variant="success">Published</Badge> : <Badge variant="secondary">Draft</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {isPublished
            ? 'Anyone with the link can answer this questionnaire.'
            : 'Publish to get a shareable link. Respondents cannot see it until you do.'}
        </p>

        {disabled && (
          <Alert>
            <p>Save your changes first — publishing shares the last saved version.</p>
          </Alert>
        )}

        {isPublished && slug && <CopyableLink url={publicUrlFor(slug)} />}

        {publish.isError && (
          <Alert variant="destructive" title="Could not update sharing">
            <p>{errorMessage(publish.error)}</p>
          </Alert>
        )}

        <Button
          type="button"
          variant={isPublished ? 'outline' : 'default'}
          onClick={() => publish.mutate(!isPublished)}
          loading={publish.isPending}
          disabled={disabled}
        >
          {isPublished ? 'Unpublish' : 'Publish'}
        </Button>
      </CardContent>
    </Card>
  );
}

function CopyableLink({ url }: { url: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the input is selectable as a fallback.
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={url}
        aria-label="Public link"
        onFocus={(event) => event.target.select()}
        className="min-w-0 flex-1 rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-sm"
      />
      <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
        {copied ? (
          <>
            <Check className="h-4 w-4" aria-hidden="true" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy
          </>
        )}
      </Button>
      <Button asChild variant="ghost" size="sm">
        <a href={url} target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Open
        </a>
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Link copied to clipboard' : ''}
      </span>
    </div>
  );
}
