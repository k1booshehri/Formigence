/**
 * Warn before losing unsaved edits.
 *
 * Two exits to cover, and they need different mechanisms:
 *  - closing or reloading the tab → the `beforeunload` event
 *  - navigating within the app → React Router's `useBlocker`, which needs a
 *    data router (see main.tsx, which uses `createBrowserRouter`)
 */
import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

const MESSAGE = 'You have unsaved changes. Leave without saving?';

export interface UnsavedChangesWarning {
  /**
   * Let the next navigation through without prompting.
   *
   * Needed when the app itself navigates straight after saving: the form is
   * still marked dirty at that instant, and prompting someone who just pressed
   * Save is nonsense.
   */
  allowNextNavigation: () => void;
}

export function useUnsavedChangesWarning(isDirty: boolean): UnsavedChangesWarning {
  const bypassRef = useRef(false);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (bypassRef.current) {
      bypassRef.current = false;
      return false;
    }
    return isDirty && currentLocation.pathname !== nextLocation.pathname;
  });

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    // A native confirm, deliberately: it is the one dialog that cannot be
    // missed, and losing written work is worth interrupting for.
    if (window.confirm(MESSAGE)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Browsers ignore custom text now, but a non-empty returnValue is still
      // what triggers the native prompt.
      event.returnValue = MESSAGE;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const allowNextNavigation = useCallback(() => {
    bypassRef.current = true;
  }, []);

  return { allowNextNavigation };
}
