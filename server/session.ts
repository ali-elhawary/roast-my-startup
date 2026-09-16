// In-memory session store. Holds the single source-of-truth state object,
// broadcasts the ENTIRE state to every client on any change, and runs the
// transition side effects. All phase changes flow through `dispatch` -> reduce.

import type { WebSocket } from 'ws';
import type { Command, ServerMessage } from '../shared/types';
import { initialState, reduce } from './state';
import { reconcileTimers } from './timers';
import { cancelFakeSession } from './fakeSession';
import { saveSession, sendFollowUpEmail } from './integrations';

let state = initialState();
const clients = new Set<WebSocket>();

export function getState() {
  return state;
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

  // If the operator intervenes, cancel any running fake session so its pending
  // timers don't fight the new state.
  if (command.type === 'reset' || command.type === 'stop') {
    cancelFakeSession();
  }

  // Side effects on the transition INTO `complete`.
  if (prev.phase !== 'complete' && state.phase === 'complete') {
    void saveSession(state);
    if (state.founder) {
      void sendFollowUpEmail(state.founder, state.sessionId ?? 'unknown');
    }
  }

  reconcileTimers(state, dispatch);
  broadcast();
}
