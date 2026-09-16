// External-service stubs. Clearly marked mock implementations — the real
// integrations get wired in later. There is no roast generation here (the
// ElevenLabs agent owns that) and no browser-side recording anywhere.

import type { Founder, SessionState } from '../shared/types';
import { sessionsCollection } from './db';

export async function saveSession(session: SessionState): Promise<void> {
  const doc = toSessionDocument(session);
  console.log(`[saveSession] ${doc.session_id} (${session.roast?.source ?? 'no-roast'})`);

  const col = sessionsCollection();
  if (!col) return; // Atlas disabled — in-memory only.
  try {
    await col.insertOne(doc);
  } catch (err) {
    // Never block the founder. Real impl would queue locally and retry async.
    console.error('[saveSession] Atlas write failed:', err);
  }
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

// Atlas document shape (event brief, section 5). Dates are stored as Date
// objects so the /panel aggregation can filter by day.
function toSessionDocument(s: SessionState) {
  const completedAt = new Date();
  const startedAt = s.founder ? new Date(s.founder.consentAt) : completedAt;
  return {
    session_id: s.sessionId,
    conversation_id: s.conversationId,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: completedAt.getTime() - startedAt.getTime(),
    source: s.sessionSource,
    participant: s.founder && {
      name: s.founder.name,
      email: s.founder.email,
      consent_accepted_at: new Date(s.founder.consentAt),
    },
    answers: s.answers,
    roast: s.roast,
  };
}
