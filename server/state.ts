// The state machine. This is the ONLY place `phase` changes. Both the live
// ElevenLabs session and the dev fake session drive state exclusively through
// `reduce`. Timeouts dispatch commands rather than mutating state directly.
//
// `reduce` is pure (state + command + now -> state) so it can be unit-tested
// later without a server.

import type { Command, Founder, Phase, SessionState } from '../shared/types';

export {
  READY_IDLE_TIMEOUT_MS,
  COMPLETE_IDLE_TIMEOUT_MS,
  QUESTION_TIMEOUT_MS,
  GENERATING_WARN_MS,
} from '../shared/constants';

let idCounter = 0;
function makeId(): string {
  idCounter += 1;
  return `s_${Date.now().toString(36)}_${idCounter.toString(36)}`;
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
    queued: null,
    answers: emptyAnswers(),
    roast: null,
    phaseStartedAt: null,
    error: null,
    stats: { sessionsToday: 0, byCategory: {} },
  };
}

// Return to `idle`, preserving only cumulative stats.
function freshIdle(stats: SessionState['stats']): SessionState {
  const s = initialState();
  s.stats = stats;
  return s;
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

function beginSession(
  stats: SessionState['stats'],
  founder: Founder,
  source: SessionState['sessionSource'],
  now: number,
): SessionState {
  const s = freshIdle(stats);
  return {
    ...s,
    phase: 'ready',
    sessionId: makeId(),
    sessionSource: source,
    founder,
    phaseStartedAt: now,
  };
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
      const founder: Founder = {
        name: command.name,
        email: command.email,
        consentAt: now,
      };
      const source = command.source ?? 'live';
      if (state.phase === 'idle') {
        return beginSession(state.stats, founder, source, now);
      }
      // Booth is busy: queue this founder for after the current session.
      return { ...state, queued: founder };
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
      // Operator or question-timeout: advance past the current question.
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

    case 'reset': {
      // Gentle reset: promote a queued founder to `ready`, else return to idle.
      if (state.queued) {
        return beginSession(state.stats, state.queued, 'live', now);
      }
      return freshIdle(state.stats);
    }

    case 'stop': {
      // Emergency stop: hard reset to idle, drop any queue.
      return freshIdle(state.stats);
    }

    case 'agentError': {
      // Surface the error for the operator; does not change phase.
      return { ...state, error: command.message };
    }

    default: {
      command satisfies never;
      return state;
    }
  }
}
