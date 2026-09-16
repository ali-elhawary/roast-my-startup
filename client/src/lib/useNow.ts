import { useEffect, useState } from 'react';

// Local ticking clock. Screens compute elapsed time from `phaseStartedAt`
// against this — the server never broadcasts timer ticks.
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
