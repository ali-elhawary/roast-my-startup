// Orchestrates the post-session follow-up: wait for ElevenLabs to finalize the
// recording, store it (GCS or local), fold the transcript + recording into the
// Atlas session document, then deliver the founder's email. Runs well after the
// founder has left the chair, and never blocks the live flow.
//
// When VIDEO_ENABLED is set, the video is the primary deliverable and the audio
// email becomes a FALLBACK: it's armed via registerAudioFallback and only fires
// if the video pipeline didn't deliver within DELIVERY_FALLBACK_MS. Otherwise
// (audio-only mode) the recording email is sent immediately, as before.

import type { SessionState } from '../shared/types';
import {
  fetchConversationAudioBuffer,
  fetchConversationDetails,
  transcriptToText,
} from './elevenlabs';
import { saveRecording } from './recordings';
import { sendFollowUpEmail } from './email';
import { sessionsCollection } from './db';
import { isGcsEnabled, signedReadUrl, uploadBuffer, SIGNED_URL_TTL_MS } from './storage';
import { withRetry } from './retry';
import { registerAudioFallback } from './delivery';

const FIRST_ATTEMPT_DELAY_MS = 15_000; // give ElevenLabs time to finalize audio
const RETRY_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 8; // ~2 minutes of polling

export function scheduleFollowUp(session: SessionState) {
  const { founder, sessionId, roast, conversationId } = session;
  if (!founder) return;

  // When video is the deliverable, followup arms the audio email as a fallback
  // instead of sending it directly; the video pipeline owns the primary send.
  const videoEnabled = process.env.VIDEO_ENABLED === 'true';
  const sid = sessionId ?? 'unknown';

  const isRealConversation = !!conversationId && !conversationId.startsWith('fake_');

  // Fake session or no live conversation: nothing to fetch, still preview the
  // email so the composition can be verified — gated the same as the real path.
  if (!isRealConversation) {
    const sendPreview = () =>
      sendFollowUpEmail({
        founder,
        sessionId: sid,
        roast,
        recordingUrl: null,
        recordingExpiresAt: null,
        watchUrl: null,
        downloadUrl: null,
      });
    if (videoEnabled) registerAudioFallback(sid, sendPreview);
    else void sendPreview();
    return;
  }

  let attempts = 0;

  const attempt = async () => {
    attempts += 1;
    try {
      const details = await fetchConversationDetails(conversationId!);
      if (details && details.status === 'done' && details.hasAudio) {
        // Store the recording: GCS object (cloud) or local file. We hold the
        // reference needed to (re)build the link at send time.
        let recordingKey: string | null = null; // GCS object key
        let localUrl: string | null = null;
        let localExpiresAt: number | null = null;

        const audio = await fetchConversationAudioBuffer(conversationId!);
        if (audio) {
          if (isGcsEnabled()) {
            const key = `recordings/${conversationId}.mp3`;
            try {
              await withRetry(() => uploadBuffer(key, audio, 'audio/mpeg'), {
                label: `gcs-upload-audio-${sid}`,
              });
              recordingKey = key;
            } catch (err) {
              console.error(`[followup] audio upload failed for ${sid}:`, err);
            }
          } else {
            const rec = await saveRecording(conversationId!, audio);
            localUrl = rec.url;
            localExpiresAt = rec.expiresAt;
          }
        }

        const transcript = transcriptToText(details.transcript);
        await updateSessionDoc(sessionId, transcript, {
          key: recordingKey,
          url: localUrl,
          expiresAt: localExpiresAt,
        });

        // Build the audio email, resolving the link (signed or local) at send
        // time so a cloud link is freshly signed when it actually goes out.
        const sendAudio = async () => {
          let recordingUrl: string | null = null;
          let recordingExpiresAt: number | null = null;
          if (recordingKey) {
            recordingUrl = await signedReadUrl(recordingKey);
            recordingExpiresAt = Date.now() + SIGNED_URL_TTL_MS;
          } else if (localUrl) {
            recordingUrl = localUrl;
            recordingExpiresAt = localExpiresAt;
          }
          await sendFollowUpEmail({
            founder,
            sessionId: sid,
            roast,
            recordingUrl,
            recordingExpiresAt,
            watchUrl: null,
            downloadUrl: null,
          });
        };

        if (videoEnabled) {
          registerAudioFallback(sid, sendAudio, {
            kind: 'audio',
            sessionId: sid,
            conversationId,
            founder,
            roast,
          });
        } else {
          await sendAudio();
        }
        console.log(
          `[followup] processed ${conversationId} (attempt ${attempts}, videoEnabled=${videoEnabled})`,
        );
        return;
      }
    } catch (err) {
      console.error(`[followup] attempt ${attempts} failed:`, err);
    }

    if (attempts < MAX_ATTEMPTS) {
      setTimeout(attempt, RETRY_INTERVAL_MS);
      return;
    }

    // Recording never finalized in time. Rather than drop the follow-up, send
    // (or arm) an email without the recording link.
    console.warn(`[followup] giving up on audio for ${conversationId}; no recording link`);
    const sendWithout = () =>
      sendFollowUpEmail({
        founder,
        sessionId: sid,
        roast,
        recordingUrl: null,
        recordingExpiresAt: null,
        watchUrl: null,
        downloadUrl: null,
      });
    if (videoEnabled) registerAudioFallback(sid, sendWithout);
    else await sendWithout();
  };

  setTimeout(attempt, FIRST_ATTEMPT_DELAY_MS);
}

async function updateSessionDoc(
  sessionId: string | null,
  transcript: string,
  recording: { key: string | null; url: string | null; expiresAt: number | null },
) {
  const col = sessionsCollection();
  if (!col || !sessionId) return;
  try {
    const recordingDoc = recording.key
      ? { storage: 'gcs', key: recording.key, expires_at: null }
      : {
          url: recording.url,
          expires_at: recording.expiresAt ? new Date(recording.expiresAt) : null,
        };
    await col.updateOne(
      { session_id: sessionId },
      { $set: { transcript, recording: recordingDoc } },
    );
  } catch (err) {
    console.error('[followup] Atlas update failed:', err);
  }
}
