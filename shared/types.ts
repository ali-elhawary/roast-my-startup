// Shared types used by both the server (state machine) and the client (screens).

export type Phase =
  | 'idle'
  | 'ready'
  | 'q1'
  | 'q2'
  | 'q3'
  | 'generating'
  | 'roasting'
  | 'complete';

export type RoastSource = 'generated' | 'fallback';

// Where the current session's commands originate. The live ElevenLabs agent
// only auto-starts on /station when this is 'live', so the operator's fake
// session (source 'fake') can drive every screen without a microphone.
export type SessionSource = 'live' | 'fake' | null;

export type Founder = {
  id: string;
  name: string;
  email: string;
  consentAt: number;
};

// A founder waiting in line. Carries the session source so promotion preserves
// live-vs-fake (so /station doesn't try to start a real agent for a fake run).
export type QueuedFounder = Founder & { source: SessionSource };

export type Roast = {
  text: string;
  category: string;
  source: RoastSource;
};

export type SessionState = {
  phase: Phase;
  sessionId: string | null;
  conversationId: string | null; // from the ElevenLabs session
  sessionSource: SessionSource;
  paused: boolean;
  founder: Founder | null;
  queue: QueuedFounder[]; // waiting line; sign-ups accumulate here
  answers: {
    building: string;
    audience: string;
    differentiation: string;
  };
  roast: Roast | null;
  phaseStartedAt: number | null;
  error: string | null;
  // Increments on every `skip` (operator or question-timeout). /station watches
  // it to nudge the live agent to move on, so the conversation and the app phase
  // stay in sync. Agent-driven advances (captureAnswer) do NOT bump it.
  skipSignal: number;
  // Increments on `restart`. /station watches it to tear down the current agent
  // session and discard the in-progress recording, then wait for a fresh Begin.
  restartSignal: number;
  // Reported by /station's video recorder so /operator can see capture/upload
  // status live. Null when not recording video.
  videoStatus: 'recording' | 'uploading' | 'uploaded' | 'error' | null;
  stats: {
    sessionsToday: number;
    byCategory: Record<string, number>;
  };
};

// Client -> server commands. In the live flow these originate from the
// ElevenLabs agent's client tools and the booth screens; in the dev flow the
// server-side fake session dispatches the same messages. Handled identically.
export type Command =
  | { type: 'signin'; name: string; email: string; source?: SessionSource }
  | { type: 'start' }
  | { type: 'conversationStarted'; conversationId: string }
  | { type: 'answer'; index: 1 | 2 | 3; text: string }
  | { type: 'roast'; text: string; category: string; source: RoastSource }
  | { type: 'complete' }
  | { type: 'next' } // Done / Call next: end current, promote next in line
  | { type: 'restart' } // operator restarts the current founder's roast (discard broken attempt)
  | { type: 'dequeue'; id: string } // operator removes someone from the line
  | { type: 'skip' } // operator (or timeout) skips the current question
  | { type: 'skipRoast' } // operator hands the founder to the Startups rep
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset' } // cancel current -> idle, keep the queue
  | { type: 'stop' } // emergency stop -> idle, keep the queue
  | { type: 'agentError'; message: string }
  | { type: 'videoStatus'; status: 'recording' | 'uploading' | 'uploaded' | 'error' };

// Server -> client message. The entire state object is broadcast on every
// change; no diffs or patches.
export type ServerMessage = { type: 'state'; state: SessionState };
