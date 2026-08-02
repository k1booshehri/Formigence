/** A countdown used to rate-limit the "resend code" button in the UI. */
import { useCallback, useEffect, useState } from 'react';

export interface Cooldown {
  /** Seconds left, 0 when ready. */
  secondsLeft: number;
  isCoolingDown: boolean;
  start: (seconds?: number) => void;
}

export function useCooldown(defaultSeconds = 30): Cooldown {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const start = useCallback(
    (seconds?: number) => setSecondsLeft(seconds ?? defaultSeconds),
    [defaultSeconds],
  );

  return { secondsLeft, isCoolingDown: secondsLeft > 0, start };
}
