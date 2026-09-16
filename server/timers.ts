// Timeouts dispatch commands rather than mutating state. A single active timer
// is reconciled after every state change, sized against `phaseStartedAt` so
// non-phase-changing commands don't extend the window.

import type { Command, SessionState } from '../shared/types';
import { IDLE_TIMEOUT_MS, QUESTION_TIMEOUT_MS } from '../shared/constants';

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
  const schedule = (durationMs: number, command: Command) => {
    const remaining = Math.max(0, durationMs - elapsed);
    handle = setTimeout(() => {
      handle = null;
      dispatch(command);
    }, remaining);
  };

  if (state.phase === 'q1' || state.phase === 'q2' || state.phase === 'q3') {
    // Question-timeout safety net: auto-advance. (In the live flow the agent's
    // own turn-taking usually moves first; this is a backstop.)
    schedule(QUESTION_TIMEOUT_MS, { type: 'skip' });
  } else if (state.phase === 'ready' || state.phase === 'complete') {
    // Idle-timeout: a founder who wandered off, or a session nobody cleared.
    schedule(IDLE_TIMEOUT_MS, { type: 'reset' });
  }
}
