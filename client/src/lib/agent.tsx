// Real ElevenLabs wiring (SDK @elevenlabs/react). The agent owns the
// conversation and the roast generation; this module is the bridge between the
// agent's client tools and the app's WebSocket command stream.
//
// Tool names here MUST match exactly what's configured in the ElevenLabs UI
// (see AGENT_PROMPT.md).

import {
  ConversationProvider,
  useConversationControls,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
  useConversationClientTool,
} from '@elevenlabs/react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { Command, Phase } from '@shared/types';
import { validateRoast } from '@shared/validate';
import { useSession } from '@/lib/ws';

type SendCommand = (command: Command) => void;

// Completion timing. We can't trust the agent to reliably call sessionComplete
// after the closing line (LLM tool calls are flaky and the closing line reads as
// a natural turn end), and the SDK's isSpeaking flag jitters — so completion is
// armed off the RELIABLE blocking deliverRoast call and driven by a single
// jitter-tolerant poller. It completes on sustained silence after speech, with an
// estimate-based backstop if silence is never detected, and a hard cap as the
// ultimate safety. The server also has a roasting-phase backstop.
const COMPLETE_SETTLE_MS = 3_000; // continuous silence after speech -> done
const COMPLETE_TAIL_MS = 2_000; // pad so the recording covers the last words
const COMPLETE_MAX_WAIT_MS = 100_000; // absolute cap from arming
const NO_SPEECH_MS = 15_000; // armed but the agent never spoke (TTS failed)
const MIN_WORDS_PER_SEC = 2.2; // conservative pace for the estimate backstop
const CLOSING_LINE_WORDS = 25; // rough closing-line length added to the estimate

export function BoothAgentProvider({
  children,
  sendCommand,
}: {
  children: ReactNode;
  sendCommand: SendCommand;
}) {
  const { state } = useSession();

  // Accumulate the founder's answer for the CURRENT question: finalized ASR
  // segments live in committedRef, and the in-progress (tentative) partial is
  // appended for display. Reset when the phase changes (new question) so a prior
  // answer never bleeds into the next.
  const committedRef = useRef('');
  const lastPhaseRef = useRef(state?.phase);
  const lastSentRef = useRef(0);
  if (state?.phase !== lastPhaseRef.current) {
    lastPhaseRef.current = state?.phase;
    committedRef.current = '';
  }

  const relayLive = (text: string, immediate = false) => {
    const now = Date.now();
    if (!immediate && now - lastSentRef.current < 100) return; // throttle ~10/s
    lastSentRef.current = now;
    sendCommand({ type: 'liveTranscript', text });
  };

  return (
    <ConversationProvider
      onConnect={(info: unknown) => {
        const id = (info as { conversationId?: string } | undefined)?.conversationId;
        if (id) sendCommand({ type: 'conversationStarted', conversationId: id });
      }}
      onError={(error: unknown) =>
        sendCommand({ type: 'agentError', message: String(error) })
      }
      onIncomingEvent={(evt: unknown) => {
        // Live founder transcription for the /audience word-by-word captions.
        // tentative_user_transcript = in-progress partial; user_transcript = the
        // finalized segment. Both must be enabled in the agent's client_events.
        const e = evt as {
          type?: string;
          tentative_user_transcription_event?: { user_transcript?: string };
          user_transcription_event?: { user_transcript?: string };
        };
        if (e?.type === 'tentative_user_transcript') {
          const partial = e.tentative_user_transcription_event?.user_transcript ?? '';
          // TEMP debug: confirm live/interim events are arriving (watch devtools).
          console.log('[live] tentative', partial.length, JSON.stringify(partial.slice(0, 60)));
          relayLive(`${committedRef.current} ${partial}`.trim());
        } else if (e?.type === 'user_transcript') {
          const finalSeg = e.user_transcription_event?.user_transcript ?? '';
          console.log('[live] final', finalSeg.length, JSON.stringify(finalSeg.slice(0, 60)));
          if (finalSeg.trim()) {
            committedRef.current = `${committedRef.current} ${finalSeg}`.trim();
            relayLive(committedRef.current, true);
          }
        }
      }}
      onAudioAlignment={(alignment: unknown) => {
        // Character-level timing for agent speech. Shape is not documented in
        // detail — log it once on the first live run, then refine the
        // /audience reveal (computeRevealSchedule) to consume it.
        console.log('[alignment]', alignment);
      }}
    >
      <BoothTools sendCommand={sendCommand} />
      {children}
    </ConversationProvider>
  );
}

function indexForPhase(phase: Phase | undefined): 1 | 2 | 3 {
  // Answer index follows the app phase (the source of truth), so an operator
  // skip doesn't misfile the next captured answer.
  if (phase === 'q1') return 1;
  if (phase === 'q2') return 2;
  return 3;
}

function BoothTools({ sendCommand }: { sendCommand: SendCommand }) {
  const { state } = useSession();
  const { isSpeaking } = useConversationMode();
  const pendingFallback = useRef(false);

  // Completion tracking (all refs so the poller reads live values without
  // re-subscribing). Armed by deliverRoast; sessionComplete is a redundant hint.
  const armedAtRef = useRef<number | null>(null);
  const speakStartRef = useRef<number | null>(null);
  const lastSpeakingAtRef = useRef<number>(0);
  const isSpeakingRef = useRef(false);
  const estSpokenMsRef = useRef<number>(0);
  const firedRef = useRef(false);

  const armComplete = useCallback((roastWords: number) => {
    if (armedAtRef.current != null) return; // already armed this session
    armedAtRef.current = Date.now();
    firedRef.current = false;
    estSpokenMsRef.current =
      ((roastWords + CLOSING_LINE_WORDS) / MIN_WORDS_PER_SEC) * 1000;
  }, []);

  const fireComplete = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    sendCommand({ type: 'complete' });
  }, [sendCommand]);

  // Track speech. Store the last-speaking timestamp instead of resetting a timer,
  // so VAD flicker during silence can't stall completion.
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
    if (isSpeaking) {
      lastSpeakingAtRef.current = Date.now();
      if (speakStartRef.current == null && armedAtRef.current != null) {
        speakStartRef.current = Date.now();
      }
    }
  }, [isSpeaking]);

  // Single poller decides when to complete. Mounted once; reads refs.
  useEffect(() => {
    const id = setInterval(() => {
      const armedAt = armedAtRef.current;
      if (armedAt == null || firedRef.current) return;
      const now = Date.now();
      const sinceArmed = now - armedAt;
      const speakStart = speakStartRef.current;

      if (speakStart != null) {
        const sinceSpeak = now - speakStart;
        const silentFor = now - lastSpeakingAtRef.current;
        // Don't let a mid-roast pause (dramatic beat, gap before the closing
        // line, or flaky isSpeaking=false) end it early: require most of the
        // estimated roast to have been spoken before silence can complete.
        const minSpokenMs = Math.max(estSpokenMsRef.current * 0.8, 18_000);
        if (sinceSpeak >= minSpokenMs && !isSpeakingRef.current && silentFor >= COMPLETE_SETTLE_MS) {
          fireComplete();
          return;
        }
        // Backstop: silence never detected (isSpeaking stuck) -> estimated end.
        if (sinceSpeak >= estSpokenMsRef.current + COMPLETE_TAIL_MS) {
          fireComplete();
          return;
        }
      } else if (sinceArmed >= NO_SPEECH_MS) {
        // Armed but the agent never started speaking (TTS/connection failure).
        fireComplete();
        return;
      }
      // Absolute cap.
      if (sinceArmed >= COMPLETE_MAX_WAIT_MS) fireComplete();
    }, 500);
    return () => clearInterval(id);
  }, [fireComplete]);

  // Reset tracking for the next founder (when the machine returns to an early
  // phase) so stale arming can't complete the next session prematurely.
  useEffect(() => {
    const p = state?.phase;
    if (p === 'idle' || p === 'ready' || p === 'q1') {
      armedAtRef.current = null;
      speakStartRef.current = null;
      lastSpeakingAtRef.current = 0;
      estSpokenMsRef.current = 0;
      firedRef.current = false;
      pendingFallback.current = false;
    }
  }, [state?.phase]);

  useConversationClientTool('captureAnswer', (parameters) => {
    const text = String((parameters as { text?: string }).text ?? '');
    sendCommand({
      type: 'answer',
      index: indexForPhase(state?.phase),
      text,
    });
    return 'captured';
  });

  // Blocking tool. The agent waits for this return value.
  useConversationClientTool('deliverRoast', (parameters) => {
    const text = String((parameters as { text?: string }).text ?? '');
    const category = String((parameters as { category?: string }).category ?? 'other');
    const result = validateRoast(text);
    if (!result.ok) {
      // Do not advance the app yet. Ask the agent to call deliverRoast again
      // with a clean fallback; we'll mark that next roast as 'fallback'.
      pendingFallback.current = true;
      return `rejected: ${result.reason}. Deliver a short, clean, generic fallback roast instead by calling deliverRoast again.`;
    }
    const source = pendingFallback.current ? 'fallback' : 'generated';
    pendingFallback.current = false;
    sendCommand({ type: 'roast', text, category, source });
    // Arm completion off this reliable blocking call — not the flaky trailing
    // sessionComplete. The poller finishes the session when the agent goes quiet.
    armComplete(text.trim().split(/\s+/).filter(Boolean).length);
    return 'approved';
  });

  useConversationClientTool('sessionComplete', () => {
    pendingFallback.current = false;
    // Redundant safety: if deliverRoast somehow didn't arm us, arm now.
    if (armedAtRef.current == null) armComplete(0);
    return 'ok';
  });

  return null;
}

export function useBoothAgent() {
  const { startSession, endSession, getId, setVolume, sendUserMessage } =
    useConversationControls();
  const { setMuted } = useConversationInput();
  const { status } = useConversationStatus();
  const { isSpeaking, isListening } = useConversationMode();

  const start = useCallback(async () => {
    await navigator.mediaDevices.getUserMedia({ audio: true });

    // Preferred: private agent via a short-lived signed URL (API key stays
    // server-side). The conversation id is reported via the provider's
    // onConnect handler in either path.
    try {
      const res = await fetch('/api/agent/signed-url');
      if (res.ok) {
        const { signedUrl } = (await res.json()) as { signedUrl: string };
        await startSession({ signedUrl });
        return;
      }
      console.warn('[agent] signed-url unavailable, trying public agentId');
    } catch (err) {
      console.warn('[agent] signed-url error, trying public agentId', err);
    }

    // Fallback: public agent via agentId (works only if the agent allows
    // unauthenticated connections).
    const cfg = await fetch('/api/agent/config');
    if (!cfg.ok) throw new Error('Could not reach agent (signed URL and config both failed)');
    const { agentId } = (await cfg.json()) as { agentId: string };
    if (!agentId) throw new Error('No agentId configured');
    await startSession({ agentId });
  }, [startSession]);

  return {
    start,
    stop: endSession,
    conversationId: getId,
    status, // 'disconnected' | 'connecting' | 'connected'
    isSpeaking,
    isListening,
    setMuted,
    setVolume,
    sendUserMessage,
  };
}
