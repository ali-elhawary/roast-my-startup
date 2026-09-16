// Real ElevenLabs wiring (SDK @elevenlabs/react). The agent owns the
// conversation and the roast generation; this module is the bridge between the
// agent's client tools and the app's WebSocket command stream.
//
// Tool names here MUST match exactly what's configured in the ElevenLabs UI
// (see AGENT_PROMPT.md).

import {
  ConversationProvider,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
  useConversationClientTool,
} from '@elevenlabs/react';
import { useCallback, useRef, type ReactNode } from 'react';
import type { Command } from '@shared/types';
import { validateRoast } from '@shared/validate';

type SendCommand = (command: Command) => void;

export function BoothAgentProvider({
  children,
  sendCommand,
}: {
  children: ReactNode;
  sendCommand: SendCommand;
}) {
  return (
    <ConversationProvider
      onConnect={(info: unknown) => {
        const id = (info as { conversationId?: string } | undefined)?.conversationId;
        if (id) sendCommand({ type: 'conversationStarted', conversationId: id });
      }}
      onError={(error: unknown) =>
        sendCommand({ type: 'agentError', message: String(error) })
      }
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

function BoothTools({ sendCommand }: { sendCommand: SendCommand }) {
  const answerCount = useRef(0);
  const pendingFallback = useRef(false);

  useConversationClientTool('captureAnswer', (parameters) => {
    const text = String((parameters as { text?: string }).text ?? '');
    answerCount.current = Math.min(answerCount.current + 1, 3);
    sendCommand({
      type: 'answer',
      index: answerCount.current as 1 | 2 | 3,
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
    return 'approved';
  });

  useConversationClientTool('sessionComplete', () => {
    answerCount.current = 0;
    pendingFallback.current = false;
    sendCommand({ type: 'complete' });
    return 'ok';
  });

  return null;
}

export function useBoothAgent() {
  const { startSession, endSession, getId } = useConversationControls();
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
  };
}
