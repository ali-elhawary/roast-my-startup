import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/ws';
import { useNow } from '@/lib/useNow';
import { BoothAgentProvider, useBoothAgent } from '@/lib/agent';
import { useVideoRecorder } from '@/lib/videoRecorder';
import { QUESTIONS, QUESTION_TIMEOUT_MS, SYNC_CALIBRATION_MS } from '@shared/constants';
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

// The agent finishes speaking the roast and only THEN calls sessionComplete
// (its built-in end_call tool is disabled), so at `complete` the last seconds
// of TTS are usually still streaming. Wait for the agent to fall silent before
// ending the live call, or the roast gets cut off. SETTLE debounces brief gaps
// between sentences; MAX_WAIT is a hard cap so teardown can never hang if
// `isSpeaking` never settles.
const SPEECH_SETTLE_MS = 1_500;
const MAX_TEARDOWN_WAIT_MS = 20_000;

function StationInner() {
  const { state, sendCommand } = useSession();
  const { start, stop, status, setMuted, setVolume, sendUserMessage, isSpeaking } =
    useBoothAgent();
  const {
    enabled: videoEnabled,
    status: recorderStatus,
    devices: cameras,
    deviceId: cameraId,
    setDeviceId: setCameraId,
    enumerate: enumerateCameras,
    openCamera,
    closeCamera,
    stream: cameraStream,
    start: startVideo,
    stopAndUpload: stopVideo,
    discard: discardVideo,
  } = useVideoRecorder();
  const [kioskReady, setKioskReady] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const startedFor = useRef<string | null>(null);
  const lastSkipSignal = useRef(0);
  const lastRestartSignal = useRef(0);
  // Pending timers for the natural `complete` teardown (see the effect below).
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest state + the metadata captured when the live session started, so the
  // async teardown can upload the video with the right session/founder/offset.
  const stateRef = useRef<SessionState | null>(state);
  stateRef.current = state;
  const liveMetaRef = useRef<{ sessionId: string | null; conversationStartMs: number } | null>(null);

  const clearTeardownTimers = useCallback(() => {
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    if (maxWaitTimer.current) {
      clearTimeout(maxWaitTimer.current);
      maxWaitTimer.current = null;
    }
  }, []);

  const finishTeardown = useCallback(() => {
    clearTeardownTimers();
    startedFor.current = null;
    void stop();
    if (videoEnabled) {
      const s = stateRef.current;
      const meta = liveMetaRef.current;
      liveMetaRef.current = null;
      void stopVideo({
        sessionId: meta?.sessionId ?? s?.sessionId ?? 'unknown',
        conversationId: s?.conversationId ?? null,
        conversationStartMs: meta?.conversationStartMs ?? 0,
        founder: s?.founder ?? null,
      });
    }
  }, [clearTeardownTimers, stop, videoEnabled, stopVideo]);

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
      // A fresh session is starting; abandon any teardown wait left over from a
      // previous session so its timers can't stop this one.
      clearTeardownTimers();
      startedFor.current = state.sessionId;
      lastSkipSignal.current = state.skipSignal;
      // conversationStartMs is filled in when the agent actually connects (see
      // the effect below) — the ElevenLabs recording's t=0 is the connect
      // moment, not this start() call, which is ~1-1.5s earlier.
      liveMetaRef.current = { sessionId: state.sessionId, conversationStartMs: 0 };
      // Retry once before surfacing the error (transient getUserMedia / signed-
      // url / connect hiccup).
      start()
        .catch(async () => {
          await new Promise((r) => setTimeout(r, 800));
          return start();
        })
        .catch((err) => sendCommand({ type: 'agentError', message: String(err) }));
      if (videoEnabled) void startVideo();
    }
  }, [state, kioskReady, start, sendCommand, clearTeardownTimers, videoEnabled, startVideo]);

  // Operator restart: abandon the current agent session + in-progress recording
  // (discard, do NOT upload), then wait for a fresh Begin. restartSignal is
  // monotonic, so any increase is a genuine restart.
  const restartSignal = state?.restartSignal ?? 0;
  useEffect(() => {
    if (restartSignal > lastRestartSignal.current) {
      lastRestartSignal.current = restartSignal;
      clearTeardownTimers();
      startedFor.current = null;
      liveMetaRef.current = null;
      void stop();
      if (videoEnabled) discardVideo();
    }
  }, [restartSignal, clearTeardownTimers, stop, videoEnabled, discardVideo]);

  // Stamp the real conversation start when the agent connects, so the video
  // audio + captions align to the founder's face (not ~1.5s early).
  useEffect(() => {
    if (status === 'connected' && liveMetaRef.current && liveMetaRef.current.conversationStartMs === 0) {
      liveMetaRef.current.conversationStartMs = Date.now() + SYNC_CALIBRATION_MS;
    }
  }, [status]);

  // Tear down the live ElevenLabs session when it ends. Two very different cases:
  //  - `idle` (emergency stop / reset): end the call immediately, even mid-roast.
  //  - `complete` (natural end): wait until the agent has been silent for
  //    SPEECH_SETTLE_MS (with MAX_TEARDOWN_WAIT_MS as a hard cap) so the tail of
  //    the roast finishes playing before we disconnect.
  // Only the live session is affected — the fake operator session never sets
  // startedFor, so it short-circuits here and its screens are untouched.
  const phase = state?.phase;
  useEffect(() => {
    if (!startedFor.current) return;

    if (phase === 'idle') {
      finishTeardown();
      return;
    }

    if (phase !== 'complete') return;

    // Hard safety cap: never wait forever for speech to settle.
    if (!maxWaitTimer.current) {
      maxWaitTimer.current = setTimeout(finishTeardown, MAX_TEARDOWN_WAIT_MS);
    }

    if (isSpeaking) {
      // Still talking — cancel any pending "settled" timer and keep waiting.
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
    } else if (!settleTimer.current) {
      // Silent for now. Confirm it stays silent before ending the call so a
      // brief pause between sentences isn't treated as the end of the roast.
      settleTimer.current = setTimeout(finishTeardown, SPEECH_SETTLE_MS);
    }
  }, [phase, isSpeaking, finishTeardown]);

  // Never leak pending teardown timers if the station unmounts.
  useEffect(() => clearTeardownTimers, [clearTeardownTimers]);

  // Open the persistent camera once the kiosk is unlocked (and re-open if the
  // operator switches camera), so the self-view is live from the ready screen.
  // Skipped while recording so it can't disturb an in-progress capture.
  useEffect(() => {
    if (kioskReady && videoEnabled && recorderStatus !== 'recording') void openCamera();
  }, [kioskReady, videoEnabled, cameraId, recorderStatus, openCamera]);

  // Release the camera when the station unmounts.
  useEffect(() => closeCamera, [closeCamera]);

  // Mirror the recorder's status to the server so /operator can see capture +
  // upload progress live.
  useEffect(() => {
    if (!videoEnabled || recorderStatus === 'idle') return;
    sendCommand({ type: 'videoStatus', status: recorderStatus });
  }, [recorderStatus, videoEnabled, sendCommand]);

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
        <div className="text-5xl font-extrabold">Booth setup</div>
        <p className="mt-4 max-w-xl text-2xl text-ink-200">
          {videoEnabled
            ? 'Tap once to enable the camera, microphone, and audio for this station.'
            : 'Tap once to enable the microphone and audio for this station.'}
        </p>
        <button
          className="mt-10 rounded-xl bg-accent px-10 py-5 text-3xl font-bold text-ink-900"
          onClick={async () => {
            try {
              const probe = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: videoEnabled,
              });
              if (videoEnabled) await enumerateCameras();
              // Release the permission-probe stream; the persistent self-view
              // stream is opened by the effect once kioskReady flips true.
              probe.getTracks().forEach((t) => t.stop());
              setKioskReady(true);
            } catch {
              setMicError(
                videoEnabled
                  ? 'Camera/microphone permission denied. Check browser settings.'
                  : 'Microphone permission denied. Check browser settings.',
              );
            }
          }}
        >
          Start kiosk
        </button>
        {micError && <p className="mt-6 text-xl text-red-400">{micError}</p>}
      </div>
    );
  }

  // Camera picker (idle/ready only) so the operator can pick the capture device
  // — e.g. a capture-card feed from a nicer camera — without clutter mid-session.
  const cameraPicker =
    videoEnabled && (state.phase === 'idle' || state.phase === 'ready') && cameras.length > 0 ? (
      <div className="fixed right-3 top-3 z-10 flex items-center gap-2 rounded-lg bg-ink-800/80 px-3 py-2 text-sm">
        <span className="text-ink-400">Camera</span>
        <select
          className="max-w-[220px] rounded bg-ink-700 px-2 py-1 text-ink-100 outline-none"
          value={cameraId}
          onChange={(e) => setCameraId(e.target.value)}
        >
          {cameras.map((c, i) => (
            <option key={c.deviceId} value={c.deviceId}>
              {c.label || `Camera ${i + 1}`}
            </option>
          ))}
        </select>
      </div>
    ) : null;

  let content: ReactNode;
  switch (state.phase) {
    case 'ready':
      content = (
        <Center>
          <div className="text-center">
            <div className="text-5xl font-bold text-ink-200">
              You&rsquo;re up{state.founder ? `, ${state.founder.name}` : ''}
            </div>
            <button
              className="mt-10 rounded-2xl bg-accent px-16 py-8 text-5xl font-black text-ink-900"
              onClick={() => sendCommand({ type: 'start' })}
            >
              Begin
            </button>
          </div>
        </Center>
      );
      break;
    case 'q1':
    case 'q2':
    case 'q3':
      content = <QuestionView state={state} />;
      break;
    case 'generating':
      content = <Thinking />;
      break;
    case 'roasting':
      content = <Listening />;
      break;
    case 'complete':
      content = (
        <Center>
          <div className="text-center">
            <div className="text-6xl font-black">Thanks &mdash; that&rsquo;s a wrap</div>
            <div className="mt-4 text-3xl text-ink-400">
              Your {videoEnabled ? 'video' : 'recording'} is on its way.
            </div>
            <button
              className="mt-10 rounded-xl bg-ink-600 px-10 py-5 text-3xl font-bold text-ink-100 hover:bg-ink-400"
              onClick={() => sendCommand({ type: 'next' })}
            >
              Done &mdash; next founder
            </button>
          </div>
        </Center>
      );
      break;
    case 'idle':
    default:
      content = (
        <Center>
          <div className="text-4xl text-ink-400">Waiting for the next founder&hellip;</div>
        </Center>
      );
  }

  const showSelfView =
    videoEnabled &&
    !!cameraStream &&
    ['ready', 'q1', 'q2', 'q3', 'generating', 'roasting'].includes(state.phase);

  return (
    <>
      {cameraPicker}
      {showSelfView && <SelfView stream={cameraStream} />}
      {videoEnabled && recorderStatus === 'recording' && (
        <div className="fixed left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-sm font-bold">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          REC
        </div>
      )}
      {videoEnabled && (recorderStatus === 'uploading' || recorderStatus === 'uploaded' || recorderStatus === 'error') && (
        <div className="fixed bottom-3 left-3 z-10 rounded-lg bg-ink-800/85 px-3 py-1.5 text-sm">
          {recorderStatus === 'uploading' && <span className="text-ink-200">Uploading video&hellip;</span>}
          {recorderStatus === 'uploaded' && <span className="text-accent">Video sent &#10003;</span>}
          {recorderStatus === 'error' && <span className="text-red-400">Video upload failed</span>}
        </div>
      )}
      {content}
    </>
  );
}

function QuestionView({ state }: { state: SessionState }) {
  const idx = state.phase === 'q1' ? 0 : state.phase === 'q2' ? 1 : 2;
  const now = useNow(100);
  const elapsed = state.phaseStartedAt ? now - state.phaseStartedAt : 0;
  const pct = Math.min(100, (elapsed / QUESTION_TIMEOUT_MS) * 100);

  return (
    <div className="flex h-full flex-col justify-center px-10">
      <div className="text-2xl font-semibold text-accent">
        Question {idx + 1} of 3
      </div>
      <div className="mt-6 text-7xl font-black leading-tight tracking-tight text-balance">
        {QUESTIONS[idx]}
      </div>

      <div className="mt-10 h-2 w-full overflow-hidden rounded-full bg-ink-700">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-100 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      {state.paused && (
        <div className="mt-6 text-3xl text-yellow-400">Paused</div>
      )}
    </div>
  );
}

// Mirrored corner self-view so the founder can see themselves during capture.
// Mirror is CSS-only; the recorded video stays correct (unmirrored).
function SelfView({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="fixed bottom-4 right-4 z-20 w-80 overflow-hidden rounded-xl border-2 border-ink-600 bg-black shadow-lg">
      <video
        ref={ref}
        autoPlay
        muted
        playsInline
        className="aspect-video w-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
      />
      <div className="absolute bottom-1 left-2 text-sm font-bold text-white/80">You</div>
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
    <div className="flex h-full flex-col items-center justify-center gap-10">
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
      <div className="text-4xl font-bold text-ink-100">Here comes your roast&hellip;</div>
      <div className="text-2xl text-ink-400">Watch the big screen.</div>
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
