// The state machine. This is the ONLY place `phase` changes. Both the live
// ElevenLabs session and the dev fake session drive state exclusively through
// `reduce`. Timeouts dispatch commands rather than mutating state directly.
//
// `reduce` is pure (state + command + now -> state) so it can be unit-tested
// later without a server.

import type { Command, Phase, QueuedFounder, SessionState } from '../shared/types';

export {
  READY_IDLE_TIMEOUT_MS,
  COMPLETE_SAFETY_TIMEOUT_MS,
  ROASTING_SAFETY_TIMEOUT_MS,
  QUESTION_TIMEOUT_MS,
  GENERATION_TIMEOUT_MS,
  GENERATING_WARN_MS,
} from '../shared/constants';

let idCounter = 0;
function makeId(): string {
  idCounter += 1;
  return `s_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}
function makeFounderId(): string {
  idCounter += 1;
  return `f_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

function emptyAnswers(): SessionState['answers'] {
  return { building: '', audience: '', differentiation: '' };
}

export function initialState(): SessionState {
  return {
    phase: 'idle',
    sessionId: null,
    conversationId: null,
    sessionSource: null,
    paused: false,
    founder: null,
    queue: [],
    answers: emptyAnswers(),
    roast: null,
    phaseStartedAt: null,
    error: null,
    skipSignal: 0,
    restartSignal: 0,
    videoStatus: null,
    stats: { sessionsToday: 0, byCategory: {} },
  };
}

// Return to `idle`, preserving cumulative stats, the waiting line, and the
// monotonic restartSignal (so /station never mistakes a new session for a
// restart).
function idleState(prev: SessionState): SessionState {
  const s = initialState();
  s.stats = prev.stats;
  s.queue = prev.queue;
  s.restartSignal = prev.restartSignal;
  return s;
}

// Start a session for `entry`. Caller passes `prev` with the entry already
// removed from the queue. Keeps stats + the remaining queue.
function beginSession(prev: SessionState, entry: QueuedFounder, now: number): SessionState {
  const s = idleState(prev);
  return {
    ...s,
    phase: 'ready',
    sessionId: makeId(),
    sessionSource: entry.source,
    founder: {
      id: entry.id,
      name: entry.name,
      email: entry.email,
      company: entry.company,
      consentAt: entry.consentAt,
    },
    phaseStartedAt: now,
  };
}

// End the current session and pull the next founder into `ready`, or go idle if
// the line is empty.
function promoteNext(prev: SessionState, now: number): SessionState {
  if (prev.queue.length > 0) {
    const [next, ...rest] = prev.queue;
    return beginSession({ ...prev, queue: rest }, next, now);
  }
  return idleState(prev);
}

const QUESTION_PHASES: Phase[] = ['q1', 'q2', 'q3'];

function keyForIndex(index: 1 | 2 | 3): keyof SessionState['answers'] {
  return index === 1 ? 'building' : index === 2 ? 'audience' : 'differentiation';
}

function nextQuestionPhase(phase: Phase): Phase | null {
  if (phase === 'q1') return 'q2';
  if (phase === 'q2') return 'q3';
  if (phase === 'q3') return 'generating';
  return null;
}

function countSession(state: SessionState): SessionState['stats'] {
  const byCategory = { ...state.stats.byCategory };
  const cat = state.roast?.category;
  if (cat) byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  return {
    sessionsToday: state.stats.sessionsToday + 1,
    byCategory,
  };
}

export function reduce(
  state: SessionState,
  command: Command,
  now: number,
): SessionState {
  switch (command.type) {
    case 'signin': {
      const entry: QueuedFounder = {
        id: makeFounderId(),
        name: command.name,
        email: command.email,
        company: command.company,
        consentAt: now,
        source: command.source ?? 'live',
      };
      const queued = { ...state, queue: [...state.queue, entry] };
      // Booth free: pull the front of the line straight into `ready`.
      // Otherwise the sign-up just waits — it never blocks the active session.
      if (state.phase === 'idle') {
        return promoteNext(queued, now);
      }
      return queued;
    }

    case 'start': {
      if (state.phase !== 'ready') return state;
      return { ...state, phase: 'q1', paused: false, phaseStartedAt: now, error: null };
    }

    case 'conversationStarted': {
      return { ...state, conversationId: command.conversationId };
    }

    case 'answer': {
      const answers = {
        ...state.answers,
        [keyForIndex(command.index)]: command.text,
      };
      if (!QUESTION_PHASES.includes(state.phase)) {
        return { ...state, answers };
      }
      const next = nextQuestionPhase(state.phase)!;
      return { ...state, answers, phase: next, phaseStartedAt: now, paused: false };
    }

    case 'skip': {
      // Operator or question-timeout: advance past the current question. Bump
      // skipSignal so /station nudges the live agent to move on too.
      if (!QUESTION_PHASES.includes(state.phase)) return state;
      const next = nextQuestionPhase(state.phase)!;
      return {
        ...state,
        phase: next,
        phaseStartedAt: now,
        paused: false,
        skipSignal: state.skipSignal + 1,
      };
    }

    case 'advance': {
      // Operator display resync: the agent moved to the next question but the
      // screen didn't (missed captureAnswer). Advance the phase WITHOUT bumping
      // skipSignal, so the agent is NOT nudged (it's already ahead).
      if (!QUESTION_PHASES.includes(state.phase)) return state;
      const next = nextQuestionPhase(state.phase)!;
      return { ...state, phase: next, phaseStartedAt: now, paused: false };
    }

    case 'roast': {
      // The agent's blocking deliverRoast tool already validated the text and
      // decided `source`. The app records it and begins the roast.
      const roast = {
        text: command.text,
        category: command.category,
        source: command.source,
      };
      return { ...state, roast, phase: 'roasting', phaseStartedAt: now };
    }

    case 'complete': {
      if (state.phase === 'idle') return state;
      return {
        ...state,
        phase: 'complete',
        paused: false,
        phaseStartedAt: now,
        stats: countSession(state),
      };
    }

    case 'skipRoast': {
      // Operator skips the roast and hands the founder to the Startups rep.
      if (state.phase === 'idle' || state.phase === 'complete') return state;
      return {
        ...state,
        phase: 'complete',
        paused: false,
        phaseStartedAt: now,
        stats: countSession(state),
      };
    }

    case 'pause': {
      if (state.phase === 'idle' || state.phase === 'complete') return state;
      return { ...state, paused: true };
    }

    case 'resume': {
      if (!state.paused) return state;
      // Restart the current phase's timer window on resume.
      return { ...state, paused: false, phaseStartedAt: now };
    }

    case 'next': {
      // Done / Call next / safety timeout: end the current session and pull the
      // next founder into `ready` (or idle if the line is empty).
      return promoteNext(state, now);
    }

    case 'restart': {
      // Operator redo: discard the current (broken) attempt and re-begin the
      // SAME founder from `ready`. Only during an active session — nothing was
      // saved/emailed yet, so the server-side discard is automatic. Bump
      // restartSignal so /station tears down the agent + drops the recording.
      if (state.phase === 'idle' || state.phase === 'complete' || !state.founder) {
        return state;
      }
      const f = state.founder;
      const entry: QueuedFounder = {
        id: f.id,
        name: f.name,
        email: f.email,
        company: f.company,
        consentAt: f.consentAt,
        source: state.sessionSource ?? 'live',
      };
      return { ...beginSession(state, entry, now), restartSignal: state.restartSignal + 1 };
    }

    case 'dequeue': {
      // Operator removes someone from the waiting line.
      return { ...state, queue: state.queue.filter((f) => f.id !== command.id) };
    }

    case 'reset': {
      // Cancel the current session -> idle, keep the waiting line intact.
      return idleState(state);
    }

    case 'stop': {
      // Emergency stop -> idle, keep the waiting line (operator calls next).
      return idleState(state);
    }

    case 'agentError': {
      // Surface the error for the operator; does not change phase.
      return { ...state, error: command.message };
    }

    case 'videoStatus': {
      // /station reporting its recorder/upload status; does not change phase.
      return { ...state, videoStatus: command.status };
    }

    default: {
      command satisfies never;
      return state;
    }
  }
}
