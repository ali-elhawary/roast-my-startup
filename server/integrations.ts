// External-service stubs. Clearly marked mock implementations — the real
// integrations get wired in later. There is no roast generation here (the
// ElevenLabs agent owns that) and no browser-side recording anywhere.

import type { Founder, SessionState } from '../shared/types';

export async function saveSession(session: SessionState): Promise<void> {
  // TODO: real implementation — write one document per completed session to
  // MongoDB Atlas. Shape mirrors the event brief (section 5). Atlas write
  // failures must never block the founder: queue locally and retry async.
  console.log('[saveSession]', JSON.stringify(toSessionDocument(session), null, 2));
}

export async function sendFollowUpEmail(
  founder: Founder,
  sessionId: string,
): Promise<void> {
  // TODO: real implementation — email the founder their recording link plus
  // MongoDB for Startups details.
  console.log(`[sendFollowUpEmail] -> ${founder.email} (session ${sessionId})`);
}

export async function fetchConversationAudio(
  conversationId: string,
): Promise<string> {
  // TODO: real implementation — call the ElevenLabs conversation audio endpoint
  // server-side with the API key, well after the founder has left the chair.
  const mockUrl = `https://example.com/recordings/${conversationId}.mp3`;
  console.log(`[fetchConversationAudio] ${conversationId} -> ${mockUrl}`);
  return mockUrl;
}

// Atlas-ready document shape (event brief, section 5). Not persisted yet.
function toSessionDocument(s: SessionState) {
  return {
    session_id: s.sessionId,
    conversation_id: s.conversationId,
    completed_at: Date.now(),
    source: s.sessionSource,
    participant: s.founder && {
      name: s.founder.name,
      email: s.founder.email,
      consent_accepted_at: s.founder.consentAt,
    },
    answers: s.answers,
    roast: s.roast,
  };
}
