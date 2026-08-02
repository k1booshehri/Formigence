/**
 * Token storage.
 *
 * localStorage keeps the session across reloads. It is readable by any script
 * on the origin, so this is only safe while the app ships no third-party
 * scripts; moving the refresh token to an httpOnly cookie is the upgrade path
 * (it needs a backend change, so it is out of scope here).
 *
 * Listeners let the fetch layer announce "the session is gone" without
 * reaching for `window.location` — the auth context subscribes and React
 * Router handles the redirect.
 */
import type { TokenPair } from './schemas';

const ACCESS_TOKEN_KEY = 'formigence.access_token';
const REFRESH_TOKEN_KEY = 'formigence.refresh_token';

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export const tokenStore = {
  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  },

  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },

  hasSession(): boolean {
    return localStorage.getItem(ACCESS_TOKEN_KEY) !== null;
  },

  save(tokens: TokenPair): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
    notify();
  },

  clear(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    notify();
  },

  /** Subscribe to session changes. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
