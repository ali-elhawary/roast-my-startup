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
  name: string;
  email: string;
  consentAt: number;
};

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
  queued: Founder | null; // next founder signed in while the booth is busy
  answers: {
    building: string;
    audience: string;
    differentiation: string;
  };
  roast: Roast | null;
  phaseStartedAt: number | null;
  error: string | null;
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
  | { type: 'skip' } // operator (or timeout) skips the current question
  | { type: 'skipRoast' } // operator hands the founder to the Startups rep
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset' }
  | { type: 'stop' } // emergency stop -> idle
  | { type: 'agentError'; message: string };

// Server -> client message. The entire state object is broadcast on every
// change; no diffs or patches.
export type ServerMessage = { type: 'state'; state: SessionState };
