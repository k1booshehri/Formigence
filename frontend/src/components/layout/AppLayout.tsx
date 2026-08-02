import { LogOut } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

export function AppLayout(): JSX.Element {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-muted/20">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <header className="border-b border-border bg-background">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <Link to="/app/questionnaires" className="font-semibold">
            Formigence
          </Link>
          <NavLink
            to="/app/questionnaires"
            className={({ isActive }) =>
              cn(
                'text-sm text-muted-foreground hover:text-foreground',
                isActive && 'font-medium text-foreground',
              )
            }
          >
            Questionnaires
          </NavLink>
          <div className="ml-auto flex items-center gap-3">
            {user && <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>}
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
