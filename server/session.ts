// In-memory session store. Holds the single source-of-truth state object,
// broadcasts the ENTIRE state to every client on any change, and runs the
// transition side effects. All phase changes flow through `dispatch` -> reduce.

import type { WebSocket } from 'ws';
import type { Command, ServerMessage, SessionState } from '../shared/types';
import { initialState, reduce } from './state';
import { reconcileTimers } from './timers';
import { cancelFakeSession } from './fakeSession';
import { saveSession } from './integrations';
import { scheduleFollowUp } from './followup';
import { sendHeadsUpEmail } from './email';

let state = initialState();
const clients = new Set<WebSocket>();

// Founder ids we've already sent a "you're almost up" heads-up to, so a given
// person is emailed at most once even as the queue churns around them.
const headsUpNotified = new Set<string>();

export function getState() {
  return state;
}

// Replace the cumulative stats (used to hydrate the /panel count from Atlas on
// startup so it survives a restart), then broadcast.
export function setStats(stats: SessionState['stats']) {
  state = { ...state, stats };
  broadcast();
}

function broadcast() {
  const message: ServerMessage = { type: 'state', state };
  const data = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

export function addClient(ws: WebSocket) {
  clients.add(ws);
  const message: ServerMessage = { type: 'state', state };
  ws.send(JSON.stringify(message));
  ws.on('close', () => clients.delete(ws));
}

export function dispatch(command: Command) {
  const prev = state;
  state = reduce(state, command, Date.now());
  console.log(`[cmd] ${command.type} -> phase=${state.phase} source=${state.sessionSource ?? '-'}`);

  // If the operator intervenes, cancel any running fake session so its pending
  // timers don't fight the new state.
  if (
    command.type === 'reset' ||
    command.type === 'stop' ||
    command.type === 'next' ||
    command.type === 'restart'
  ) {
    cancelFakeSession();
  }

  // Side effects on the transition INTO `complete`. Save the session doc now;
  // fetch the recording + transcript and email the founder asynchronously, well
  // after they've left the chair.
  if (prev.phase !== 'complete' && state.phase === 'complete') {
    void saveSession(state);
    scheduleFollowUp(state);
  }

  // Heads-up email (Option B): only while a session is active, ping the person
  // who is second in line (queue[1]) — i.e. next up after the founder now at the
  // booth — so they can start walking over. Live sign-ups only; best-effort,
  // fire-and-forget, de-duped per founder id.
  const onDeck = state.queue[1];
  if (
    state.founder &&
    onDeck &&
    onDeck.source === 'live' &&
    !headsUpNotified.has(onDeck.id)
  ) {
    headsUpNotified.add(onDeck.id);
    void sendHeadsUpEmail(onDeck).catch((err) => {
      console.error('[email] heads-up failed:', err);
    });
  }

  reconcileTimers(state, dispatch);
  broadcast();
}
