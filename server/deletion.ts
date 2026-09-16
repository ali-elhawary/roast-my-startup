// Deletion path (brief, data handling): a founder who asks to be removed gets
// their session document, their hosted recording, and the ElevenLabs
// conversation deleted. Look them up by session id or email.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sessionsCollection } from './db';
import { RECORDINGS_DIR } from './recordings';

const API = 'https://api.elevenlabs.io/v1/convai';

export type DeleteQuery = { sessionId?: string; email?: string };

export type DeleteSummary = {
  matched: number;
  sessionsDeleted: number;
  recordingsDeleted: number;
  conversationsDeleted: number;
  errors: string[];
};

export async function deleteSessions(query: DeleteQuery): Promise<DeleteSummary> {
  const summary: DeleteSummary = {
    matched: 0,
    sessionsDeleted: 0,
    recordingsDeleted: 0,
    conversationsDeleted: 0,
    errors: [],
  };

  const col = sessionsCollection();
  if (!col) {
    summary.errors.push('Atlas not enabled');
    return summary;
  }

  const filter: Record<string, unknown> = {};
  if (query.sessionId) filter.session_id = query.sessionId;
  else if (query.email) filter['participant.email'] = query.email;
  else {
    summary.errors.push('provide sessionId or email');
    return summary;
  }

  const docs = await col.find(filter).toArray();
  summary.matched = docs.length;

  const apiKey = process.env.ELEVENLABS_API_KEY;

  for (const doc of docs) {
    const conversationId = (doc.conversation_id as string | null) ?? null;
    if (!conversationId) continue;

    // Local recording file
    const file = path.join(RECORDINGS_DIR, `${conversationId}.mp3`);
    try {
      await fs.unlink(file);
      summary.recordingsDeleted += 1;
    } catch {
      /* not present — fine */
    }

    // ElevenLabs conversation (skip fake ids)
    if (apiKey && !conversationId.startsWith('fake_')) {
      try {
        const res = await fetch(`${API}/conversations/${conversationId}`, {
          method: 'DELETE',
          headers: { 'xi-api-key': apiKey },
        });
        if (res.ok) summary.conversationsDeleted += 1;
        else summary.errors.push(`ElevenLabs delete ${conversationId}: ${res.status}`);
      } catch (err) {
        summary.errors.push(`ElevenLabs delete ${conversationId}: ${String(err)}`);
      }
    }
  }

  const result = await col.deleteMany(filter);
  summary.sessionsDeleted = result.deletedCount ?? 0;
  return summary;
}
