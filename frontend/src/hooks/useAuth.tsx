/**
 * Session state.
 *
 * The fetch layer owns tokens and clears them when a refresh fails; this
 * context subscribes to that store, so a failed refresh anywhere in the app
 * flips `isAuthenticated` to false and `ProtectedRoute` redirects. Nothing
 * calls `window.location`.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api } from '@/api/endpoints';
import { ApiError } from '@/api/errors';
import type { User } from '@/api/schemas';
import { tokenStore } from '@/api/tokens';

interface AuthContextValue {
  isAuthenticated: boolean;
  user: User | null;
  isLoadingUser: boolean;
  signIn: (email: string, code: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Subscribe to the token store without tearing during concurrent renders. */
function useHasSession(): boolean {
  const [hasSession, setHasSession] = useState(() => tokenStore.hasSession());
  useEffect(() => tokenStore.subscribe(() => setHasSession(tokenStore.hasSession())), []);
  return hasSession;
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const hasSession = useHasSession();
  const queryClient = useQueryClient();

  const userQuery = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    enabled: hasSession,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) => {
      // A 401 here means the session is genuinely gone; retrying cannot help.
      if (error instanceof ApiError && error.isUnauthorized) return false;
      return failureCount < 1;
    },
  });

  const signIn = useCallback(
    async (email: string, code: string) => {
      const tokens = await api.verifyOtp(email, code);
      tokenStore.save(tokens);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    [queryClient],
  );

  const signOut = useCallback(() => {
    tokenStore.clear();
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: hasSession,
      user: userQuery.data ?? null,
      isLoadingUser: hasSession && userQuery.isPending,
      signIn,
      signOut,
    }),
    [hasSession, userQuery.data, userQuery.isPending, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
