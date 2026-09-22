// Timeouts dispatch commands rather than mutating state. A single active timer
// is reconciled after every state change, sized against `phaseStartedAt` so
// non-phase-changing commands don't extend the window.

import type { Command, SessionState } from '../shared/types';
import {
  COMPLETE_SAFETY_TIMEOUT_MS,
  GENERATION_TIMEOUT_MS,
  QUESTION_TIMEOUT_MS,
  READY_IDLE_TIMEOUT_MS,
} from '../shared/constants';

let handle: ReturnType<typeof setTimeout> | null = null;

export function cancelTimers() {
  if (handle) {
    clearTimeout(handle);
    handle = null;
  }
}

export function reconcileTimers(
  state: SessionState,
  dispatch: (command: Command) => void,
) {
  cancelTimers();
  if (state.paused) return;
  if (state.phaseStartedAt == null) return;

  const elapsed = Date.now() - state.phaseStartedAt;
  const schedule = (durationMs: number, action: () => void) => {
    const remaining = Math.max(0, durationMs - elapsed);
    handle = setTimeout(() => {
      handle = null;
      action();
    }, remaining);
  };

  if (state.phase === 'q1' || state.phase === 'q2' || state.phase === 'q3') {
    // Question-timeout safety net: auto-advance. (In the live flow the agent's
    // own turn-taking usually moves first; this is a backstop.)
    schedule(QUESTION_TIMEOUT_MS, () => dispatch({ type: 'skip' }));
  } else if (state.phase === 'generating') {
    // Hung generation (agent/network failure): end gracefully and surface the
    // error so the booth advances instead of freezing the chair.
    schedule(GENERATION_TIMEOUT_MS, () => {
      dispatch({ type: 'agentError', message: 'Generation timed out' });
      dispatch({ type: 'complete' });
    });
  } else if (state.phase === 'ready') {
    // Founder who's up never tapped Begin — skip the no-show to the next in line.
    schedule(READY_IDLE_TIMEOUT_MS, () => dispatch({ type: 'next' }));
  } else if (state.phase === 'complete') {
    // The roast card stays until Done; this long backstop only fires if the
    // booth is abandoned, so the line can't get stuck.
    schedule(COMPLETE_SAFETY_TIMEOUT_MS, () => dispatch({ type: 'next' }));
  }
}
