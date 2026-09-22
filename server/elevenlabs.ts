// Server-side ElevenLabs conversation retrieval. Runs after a session ends,
// with the API key that never reaches the browser. There is no browser-side
// recording anywhere in this app.

const BASE = 'https://api.elevenlabs.io/v1/convai';

function apiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY || null;
}

export type TranscriptTurn = { role: string; message: string; timeInCallSecs: number };

export type ConversationDetails = {
  status: string; // 'processing' | 'done' | ...
  hasAudio: boolean;
  transcript: TranscriptTurn[];
  callDurationSecs: number | null; // real audio length, for caption timing
};

export async function fetchConversationDetails(
  conversationId: string,
): Promise<ConversationDetails | null> {
  const key = apiKey();
  if (!key) return null;
  const res = await fetch(`${BASE}/conversations/${conversationId}`, {
    headers: { 'xi-api-key': key },
  });
  if (!res.ok) return null;
  const d = (await res.json()) as {
    status?: string;
    has_audio?: boolean;
    transcript?: Array<{ role?: string; message?: string | null; time_in_call_secs?: number }>;
    metadata?: { call_duration_secs?: number };
  };
  const transcript: TranscriptTurn[] = (d.transcript ?? [])
    .map((t) => ({
      role: t.role ?? 'unknown',
      message: (t.message ?? '').trim(),
      timeInCallSecs: t.time_in_call_secs ?? 0,
    }))
    .filter((t) => t.message.length > 0);
  return {
    status: d.status ?? 'unknown',
    hasAudio: !!d.has_audio,
    transcript,
    callDurationSecs: d.metadata?.call_duration_secs ?? null,
  };
}

export async function fetchConversationAudioBuffer(
  conversationId: string,
): Promise<Buffer | null> {
  const key = apiKey();
  if (!key) return null;
  const res = await fetch(`${BASE}/conversations/${conversationId}/audio`, {
    headers: { 'xi-api-key': key },
  });
  if (!res.ok) return null;
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Flatten the transcript into readable text for the session record / email.
export function transcriptToText(turns: TranscriptTurn[]): string {
  return turns
    .map((t) => `${t.role === 'agent' ? 'Host' : 'Founder'}: ${t.message}`)
    .join('\n');
}
