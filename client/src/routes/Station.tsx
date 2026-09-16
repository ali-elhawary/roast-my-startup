import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/ws';
import { useNow } from '@/lib/useNow';
import { BoothAgentProvider, useBoothAgent } from '@/lib/agent';
import { QUESTIONS, QUESTION_TIMEOUT_MS } from '@shared/constants';
import type { SessionState } from '@shared/types';

// Small screen in front of the founder. Owns the live ElevenLabs session.
export default function Station() {
  const { sendCommand } = useSession();
  return (
    <BoothAgentProvider sendCommand={sendCommand}>
      <StationInner />
    </BoothAgentProvider>
  );
}

function StationInner() {
  const { state, sendCommand } = useSession();
  const { start, stop, status, setMuted, setVolume, sendUserMessage } = useBoothAgent();
  const [kioskReady, setKioskReady] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const startedFor = useRef<string | null>(null);
  const lastSkipSignal = useRef(0);

  // Auto-start the live agent when the operator moves the session into q1 —
  // but only for live sessions (not the operator's fake session), and only once
  // the kiosk has been unlocked with a user gesture (mic + autoplay).
  useEffect(() => {
    if (!state || !kioskReady) return;

    if (
      state.sessionSource === 'live' &&
      state.phase === 'q1' &&
      startedFor.current !== state.sessionId
    ) {
      startedFor.current = state.sessionId;
      lastSkipSignal.current = state.skipSignal;
      start().catch((err) =>
        sendCommand({ type: 'agentError', message: String(err) }),
      );
    }

    if ((state.phase === 'idle' || state.phase === 'complete') && startedFor.current) {
      startedFor.current = null;
      void stop();
    }
  }, [state, kioskReady, start, stop, sendCommand]);

  // Pause/resume the LIVE agent: mute the mic and silence output while paused,
  // restore on resume. Only meaningful while connected.
  const paused = state?.paused ?? false;
  useEffect(() => {
    if (status !== 'connected') return;
    setMuted(paused);
    setVolume({ volume: paused ? 0 : 1 });
  }, [paused, status, setMuted, setVolume]);

  // Operator skip (or the question timeout) bumps skipSignal. Nudge the live
  // agent to move on so it doesn't keep asking the question the app already
  // advanced past.
  const skipSignal = state?.skipSignal ?? 0;
  const phase = state?.phase;
  useEffect(() => {
    if (status !== 'connected') {
      lastSkipSignal.current = skipSignal;
      return;
    }
    if (skipSignal > lastSkipSignal.current) {
      lastSkipSignal.current = skipSignal;
      const nudge =
        phase === 'generating'
          ? "That's all my answers — go ahead and roast me."
          : "Let's move on to the next question.";
      try {
        sendUserMessage(nudge);
      } catch {
        /* not connected yet; ignore */
      }
    }
  }, [skipSignal, status, phase, sendUserMessage]);

  if (!state) return <Center>Connecting&hellip;</Center>;

  if (!kioskReady) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-10 text-center">
        <div className="text-4xl font-extrabold">Booth setup</div>
        <p className="mt-4 max-w-md text-xl text-ink-200">
          Tap once to enable the microphone and audio for this station.
        </p>
        <button
          className="mt-10 rounded-xl bg-accent px-10 py-5 text-2xl font-bold text-ink-900"
          onClick={async () => {
            try {
              await navigator.mediaDevices.getUserMedia({ audio: true });
              setKioskReady(true);
            } catch {
              setMicError('Microphone permission denied. Check browser settings.');
            }
          }}
        >
          Start kiosk
        </button>
        {micError && <p className="mt-6 text-lg text-red-400">{micError}</p>}
      </div>
    );
  }

  switch (state.phase) {
    case 'ready':
      return (
        <Center>
          <div className="text-center">
            <div className="text-5xl font-black text-accent">Ready when you are</div>
            {state.founder && (
              <div className="mt-4 text-3xl text-ink-200">{state.founder.name}</div>
            )}
          </div>
        </Center>
      );
    case 'q1':
    case 'q2':
    case 'q3':
      return <QuestionView state={state} />;
    case 'generating':
      return <Thinking />;
    case 'roasting':
      return <Listening />;
    case 'complete':
      return (
        <Center>
          <div className="text-center">
            <div className="text-5xl font-black">Thanks &mdash; check your email</div>
            <div className="mt-4 text-2xl text-ink-400">
              Your recording is on its way.
            </div>
          </div>
        </Center>
      );
    case 'idle':
    default:
      return (
        <Center>
          <div className="text-3xl text-ink-400">Waiting for the next founder&hellip;</div>
        </Center>
      );
  }
}

function QuestionView({ state }: { state: SessionState }) {
  const idx = state.phase === 'q1' ? 0 : state.phase === 'q2' ? 1 : 2;
  const now = useNow(100);
  const elapsed = state.phaseStartedAt ? now - state.phaseStartedAt : 0;
  const pct = Math.min(100, (elapsed / QUESTION_TIMEOUT_MS) * 100);

  return (
    <div className="flex h-full flex-col justify-center px-10">
      <div className="text-xl font-semibold text-accent">
        Question {idx + 1} of 3
      </div>
      <div className="mt-6 text-6xl font-black leading-tight tracking-tight text-balance">
        {QUESTIONS[idx]}
      </div>
      <div className="mt-12 h-2 w-full overflow-hidden rounded-full bg-ink-700">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-100 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      {state.paused && (
        <div className="mt-6 text-2xl text-yellow-400">Paused</div>
      )}
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex items-end gap-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-6 w-6 rounded-full bg-accent"
            style={{ animation: 'dotBlink 1s infinite', animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function Listening() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative flex h-40 w-40 items-center justify-center">
        <span
          className="absolute h-40 w-40 rounded-full border-2 border-accent"
          style={{ animation: 'pulseRing 2s ease-out infinite' }}
        />
        <span
          className="absolute h-40 w-40 rounded-full border-2 border-accent"
          style={{ animation: 'pulseRing 2s ease-out infinite', animationDelay: '1s' }}
        />
        <span className="h-24 w-24 rounded-full bg-accent" />
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-10 text-ink-100">
      {children}
    </div>
  );
}
