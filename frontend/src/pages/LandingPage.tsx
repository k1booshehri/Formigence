/**
 * The public front door.
 *
 * `/` used to redirect straight into the app, which meant an anonymous visitor
 * landed on a sign-in form with no idea what they were signing in to. This page
 * explains the product and hands them to `/login` when they are ready — or
 * straight back to their questionnaires if they already have a session.
 */
import { ArrowRight, ListChecks, Mail, PenLine, ShieldCheck, Share2, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/useAuth';

const STEPS = [
  {
    icon: ListChecks,
    title: 'Build the questionnaire',
    body: 'Multiple choice, rating scales and short text — the questions you would ask in a first conversation.',
  },
  {
    icon: PenLine,
    title: 'Write the analysis guide',
    body: 'In your own words, how the answers should be read: what matters most, what to recommend when. It stays private.',
  },
  {
    icon: Share2,
    title: 'Share the link',
    body: 'Anyone with the link can answer. Each submission comes back with a recommendation written for that person.',
  },
] as const;

const POINTS = [
  {
    icon: ShieldCheck,
    title: 'Your guide stays yours',
    body: 'The analysis guide never leaves the server. Respondents are sent the questions and nothing else.',
  },
  {
    icon: Sparkles,
    title: 'A result, not a transcript',
    body: 'Every analysis returns the same shape: a recommendation, the reasoning behind it, and a confidence level.',
  },
  {
    icon: Mail,
    title: 'Nothing to remember',
    body: 'Sign in with a one-time code by email. No password to choose, store, or reset.',
  },
] as const;

export default function LandingPage(): JSX.Element {
  const { isAuthenticated } = useAuth();
  const primaryHref = isAuthenticated ? '/app/questionnaires' : '/login';
  const primaryLabel = isAuthenticated ? 'Go to your questionnaires' : 'Get started';

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <header className="border-b border-border">
        <nav className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4">
          <span className="font-semibold">Formigence</span>
          <a
            href="#how-it-works"
            className="ml-auto text-sm text-muted-foreground hover:text-foreground"
          >
            How it works
          </a>
          <Button asChild size="sm">
            <Link to={primaryHref}>{isAuthenticated ? 'Open the app' : 'Sign in'}</Link>
          </Button>
        </nav>
      </header>

      <main id="main">
        <section className="border-b border-border bg-muted/20">
          <div className="mx-auto max-w-5xl px-4 py-20 sm:py-28">
            <div className="max-w-2xl">
              <Badge variant="outline">Assessments that answer back</Badge>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
                Turn a questionnaire into a recommendation.
              </h1>
              <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
                Ask the questions you would ask in a first meeting. Write down how you would read
                the answers. Share a link — and everyone who fills it in gets a considered
                recommendation instead of a thank-you page.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link to={primaryHref}>
                    {primaryLabel}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <a href="#how-it-works">See how it works</a>
                </Button>
              </div>
              {!isAuthenticated && (
                <p className="mt-4 text-sm text-muted-foreground">
                  No password to set up — we email you a one-time code.
                </p>
              )}
            </div>
          </div>
        </section>

        <Section
          id="how-it-works"
          title="How it works"
          lead="Three steps, and only the first two need you."
        >
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <Card className="h-full">
                  <CardContent className="space-y-3 p-6">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                        {index + 1}
                      </span>
                      <step.icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <h3 className="font-medium">{step.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          title="What you get"
          lead="The details that decide whether this is usable in front of a client."
          className="border-t border-border bg-muted/20"
        >
          <ul className="grid gap-4 sm:grid-cols-3">
            {POINTS.map((point) => (
              <li key={point.title}>
                <Card className="h-full">
                  <CardContent className="space-y-3 p-6">
                    <point.icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    <h3 className="font-medium">{point.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{point.body}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </Section>

        <section className="border-t border-border">
          <div className="mx-auto max-w-5xl px-4 py-20 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">
              Your first questionnaire takes a few minutes.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              Write the questions, write the guide, send the link. You can change either one
              afterwards without losing the answers you have already collected.
            </p>
            <Button asChild size="lg" className="mt-8">
              <Link to={primaryHref}>
                {primaryLabel}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-6 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Formigence</span>
          <span>AI-assisted assessments.</span>
          <Link to={primaryHref} className="ml-auto hover:text-foreground">
            {isAuthenticated ? 'Open the app' : 'Sign in'}
          </Link>
        </div>
      </footer>
    </div>
  );
}

interface SectionProps {
  id?: string;
  title: string;
  lead: string;
  className?: string;
  children: ReactNode;
}

function Section({ id, title, lead, className, children }: SectionProps): JSX.Element {
  return (
    <section id={id} className={className}>
      <div className="mx-auto max-w-5xl px-4 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 text-muted-foreground">{lead}</p>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}
