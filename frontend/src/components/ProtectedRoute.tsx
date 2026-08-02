import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';
import { DefaultLoading } from '@/components/QueryState';

/**
 * Gate for `/app/*`.
 *
 * The session flag comes from the token store, so a failed refresh anywhere in
 * the app lands here on the next render and sends the user to /login, keeping
 * the attempted path so they return to it after signing in.
 */
export function ProtectedRoute(): JSX.Element {
  const { isAuthenticated, isLoadingUser } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (isLoadingUser) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <DefaultLoading />
      </div>
    );
  }
  return <Outlet />;
}
