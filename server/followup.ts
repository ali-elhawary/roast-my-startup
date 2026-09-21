// Orchestrates the post-session follow-up: wait for ElevenLabs to finalize the
// recording, download + host it, fold the transcript + recording into the Atlas
// session document, then send the founder their email. Runs well after the
// founder has left the chair, and never blocks the live flow.

import type { SessionState } from '../shared/types';
import {
  fetchConversationAudioBuffer,
  fetchConversationDetails,
  transcriptToText,
} from './elevenlabs';
import { saveRecording } from './recordings';
import { sendFollowUpEmail } from './email';
import { sessionsCollection } from './db';

const FIRST_ATTEMPT_DELAY_MS = 15_000; // give ElevenLabs time to finalize audio
const RETRY_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 8; // ~2 minutes of polling

export function scheduleFollowUp(session: SessionState) {
  const { founder, sessionId, roast, conversationId } = session;
  if (!founder) return;

  // When video is the deliverable, the video pipeline (server/video.ts) owns the
  // email. followup still fetches the transcript + audio and records them on the
  // session doc, but suppresses the audio-only email to avoid double-sending.
  const emailAudio = process.env.VIDEO_ENABLED !== 'true';

  const isRealConversation = !!conversationId && !conversationId.startsWith('fake_');

  // Fake session or no live conversation: nothing to fetch, still preview the
  // email so the composition can be verified.
  if (!isRealConversation) {
    if (emailAudio) {
      void sendFollowUpEmail({
        founder,
        sessionId: sessionId ?? 'unknown',
        roast,
        recordingUrl: null,
        recordingExpiresAt: null,
      });
    }
    return;
  }

  let attempts = 0;

  const attempt = async () => {
    attempts += 1;
    try {
      const details = await fetchConversationDetails(conversationId!);
      if (details && details.status === 'done' && details.hasAudio) {
        let recordingUrl: string | null = null;
        let recordingExpiresAt: number | null = null;

        const audio = await fetchConversationAudioBuffer(conversationId!);
        if (audio) {
          const rec = await saveRecording(conversationId!, audio);
          recordingUrl = rec.url;
          recordingExpiresAt = rec.expiresAt;
        }

        const transcript = transcriptToText(details.transcript);
        await updateSessionDoc(sessionId, transcript, recordingUrl, recordingExpiresAt);

        if (emailAudio) {
          await sendFollowUpEmail({
            founder,
            sessionId: sessionId ?? 'unknown',
            roast,
            recordingUrl,
            recordingExpiresAt,
          });
        }
        console.log(`[followup] processed ${conversationId} (attempt ${attempts}, emailAudio=${emailAudio})`);
        return;
      }
    } catch (err) {
      console.error(`[followup] attempt ${attempts} failed:`, err);
    }

    if (attempts < MAX_ATTEMPTS) {
      setTimeout(attempt, RETRY_INTERVAL_MS);
    } else if (emailAudio) {
      // Recording never finalized in time — send the email without it rather
      // than dropping the follow-up entirely.
      console.warn(`[followup] giving up on audio for ${conversationId}; emailing without recording`);
      await sendFollowUpEmail({
        founder,
        sessionId: sessionId ?? 'unknown',
        roast,
        recordingUrl: null,
        recordingExpiresAt: null,
      });
    }
  };

  setTimeout(attempt, FIRST_ATTEMPT_DELAY_MS);
}

async function updateSessionDoc(
  sessionId: string | null,
  transcript: string,
  recordingUrl: string | null,
  recordingExpiresAt: number | null,
) {
  const col = sessionsCollection();
  if (!col || !sessionId) return;
  try {
    await col.updateOne(
      { session_id: sessionId },
      {
        $set: {
          transcript,
          recording: {
            url: recordingUrl,
            expires_at: recordingExpiresAt ? new Date(recordingExpiresAt) : null,
          },
        },
      },
    );
  } catch (err) {
    console.error('[followup] Atlas update failed:', err);
  }
}
