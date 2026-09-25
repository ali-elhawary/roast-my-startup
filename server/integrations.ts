// Session persistence. The ElevenLabs agent owns roast generation, and the
// recording/transcript/email pipeline lives in followup.ts — this module just
// writes the completed-session document to Atlas.

import type { SessionState } from '../shared/types';
import { sessionsCollection } from './db';
import { enqueueSessionWrite } from './writeQueue';

export async function saveSession(session: SessionState): Promise<void> {
  const doc = toSessionDocument(session);
  console.log(`[saveSession] ${doc.session_id} (${session.roast?.source ?? 'no-roast'})`);

  const col = sessionsCollection();
  if (!col) return; // Atlas disabled — in-memory only.
  try {
    await col.insertOne(doc);
  } catch (err) {
    // Never block the founder: queue locally and let the flusher retry.
    console.error('[saveSession] Atlas write failed, queuing for retry:', err);
    await enqueueSessionWrite(doc);
  }
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
      company: s.founder.company,
      consent_accepted_at: new Date(s.founder.consentAt),
    },
    answers: s.answers,
    roast: s.roast,
  };
}
