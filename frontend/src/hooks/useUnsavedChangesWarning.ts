/**
 * Warn before losing unsaved edits.
 *
 * Two exits to cover, and they need different mechanisms:
 *  - closing or reloading the tab → the `beforeunload` event
 *  - navigating within the app → React Router's `useBlocker`, which needs a
 *    data router (see main.tsx, which uses `createBrowserRouter`)
 */
import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';

const MESSAGE = 'You have unsaved changes. Leave without saving?';

export function useUnsavedChangesWarning(isDirty: boolean): void {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    // eslint-disable-next-line no-alert
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
}
