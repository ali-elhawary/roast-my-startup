// Coordinates the video-vs-audio fallback for cloud delivery. The video pipeline
// is the primary deliverable; the audio "listen back" email is a fallback that
// only fires if the video didn't make it out within DELIVERY_FALLBACK_MS.
//
// Two responsibilities:
//   1. Fallback scheduling (in-memory): registerAudioFallback / markDelivered
//      track which sessions have been delivered and hold a per-session timer.
//   2. Actual delivery (runDelivery): upload to GCS + email, used both for the
//      first attempt (from video.ts) and for re-runs from the deliveryQueue.
//
// All of this only does real work when GCS/SMTP are configured; with GCS off the
// local pipeline in video.ts/followup.ts handles delivery directly.

import { randomBytes } from 'node:crypto';
import { DELIVERY_FALLBACK_MS } from '../shared/constants';
import { withRetry } from './retry';
import {
  SIGNED_URL_TTL_MS,
  isGcsEnabled,
  signedReadUrl,
  uploadBuffer,
  uploadFile,
} from './storage';
import { videoPlayerPage } from './watchPage';
import { sendFollowUpEmail } from './email';
import { recordingPublicUrl } from './recordings';
import { sessionsCollection } from './db';
import {
  enqueueDelivery,
  type AudioDeliveryJob,
  type DeliveryJob,
  type VideoDeliveryJob,
} from './deliveryQueue';

// Sessions whose deliverable has gone out (video OR audio). Prevents a late
// audio fallback from double-sending after the video already delivered.
const delivered = new Set<string>();
// Pending audio-fallback timers, keyed by session.
const pendingFallbacks = new Map<string, ReturnType<typeof setTimeout>>();

// Arm the audio fallback for a session. If the video delivers first,
// markDelivered() cancels this before it fires. On fire, send the audio email
// (with retries); if that ultimately fails, queue it durably.
export function registerAudioFallback(
  sessionId: string,
  sendAudio: () => Promise<void>,
  audioJob?: AudioDeliveryJob,
): void {
  if (delivered.has(sessionId)) return;

  const existing = pendingFallbacks.get(sessionId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    pendingFallbacks.delete(sessionId);
    if (delivered.has(sessionId)) return; // video beat us to it

    try {
      await withRetry(sendAudio, { label: `delivery-audio-${sessionId}` });
    } catch (err) {
      console.error(`[delivery] audio fallback failed for ${sessionId}:`, err);
      if (audioJob) await enqueueDelivery(audioJob);
    }
    markDelivered(sessionId);
  }, DELIVERY_FALLBACK_MS);

  pendingFallbacks.set(sessionId, timer);
  console.log(
    `[delivery] audio fallback armed for ${sessionId} (${DELIVERY_FALLBACK_MS}ms)`,
  );
}

// Mark a session delivered and cancel any pending audio fallback.
export function markDelivered(sessionId: string): void {
  delivered.add(sessionId);
  const timer = pendingFallbacks.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    pendingFallbacks.delete(sessionId);
  }
}

// Re-run a queued delivery. Throws on failure so the deliveryQueue keeps the job.
export async function runDelivery(job: DeliveryJob): Promise<void> {
  if (job.kind === 'video') return deliverVideo(job);
  return deliverAudio(job);
}

// Upload the video (+captions+player page) to GCS, record the object keys on the
// session doc, and email the founder 7-day signed Watch/Download links. Also
// used by video.ts for the first delivery attempt.
export async function deliverVideo(job: VideoDeliveryJob): Promise<void> {
  const rand = randomBytes(6).toString('hex');
  const mp4Key = `videos/${job.sessionId}-${rand}.mp4`;
  const vttKey = `videos/${job.sessionId}-${rand}.vtt`;
  const htmlKey = `videos/${job.sessionId}-${rand}.html`;
  const hasCaptions = !!job.vttPath;

  await withRetry(() => uploadFile(mp4Key, job.mp4Path, 'video/mp4'), {
    label: `gcs-upload-mp4-${job.sessionId}`,
  });
  if (job.vttPath) {
    await withRetry(() => uploadFile(vttKey, job.vttPath!, 'text/vtt'), {
      label: `gcs-upload-vtt-${job.sessionId}`,
    });
  }

  const streamUrl = await withRetry(() => signedReadUrl(mp4Key), {
    label: `gcs-sign-mp4-${job.sessionId}`,
  });
  const vttUrl = hasCaptions
    ? await withRetry(() => signedReadUrl(vttKey), { label: `gcs-sign-vtt-${job.sessionId}` })
    : null;
  const downloadUrl = await withRetry(
    () => signedReadUrl(mp4Key, { downloadFilename: 'roast-my-startup.mp4' }),
    { label: `gcs-sign-download-${job.sessionId}` },
  );

  const html = videoPlayerPage({ streamUrl, vttUrl, downloadUrl });
  await withRetry(() => uploadBuffer(htmlKey, Buffer.from(html, 'utf8'), 'text/html'), {
    label: `gcs-upload-html-${job.sessionId}`,
  });
  const watchUrl = await withRetry(() => signedReadUrl(htmlKey), {
    label: `gcs-sign-html-${job.sessionId}`,
  });

  const expiresAt = Date.now() + SIGNED_URL_TTL_MS;

  // Store OBJECT KEYS (not the signed URLs, which expire) so deletion + any
  // future re-signing can find the objects.
  await updateSessionVideoKeys(job.sessionId, {
    videoKey: mp4Key,
    vttKey: hasCaptions ? vttKey : null,
    playerKey: htmlKey,
    hasCaptions,
    expiresAt,
  });

  // If the audio fallback already emailed this founder (a slow transcode that
  // lost the race), don't double-send. The video objects + Atlas keys are still
  // saved above, so the recording exists — we just skip the second email.
  if (job.founder && !delivered.has(job.sessionId)) {
    await withRetry(
      () =>
        sendFollowUpEmail({
          founder: job.founder!,
          sessionId: job.sessionId,
          roast: job.roast,
          recordingUrl: null,
          recordingExpiresAt: expiresAt,
          watchUrl,
          downloadUrl,
        }),
      { label: `email-video-${job.sessionId}` },
    );
  } else if (job.founder) {
    console.log(
      `[delivery] video ready for ${job.sessionId} but audio fallback already emailed; skipping duplicate`,
    );
  }

  markDelivered(job.sessionId);
  console.log(`[delivery] video delivered for ${job.sessionId} -> ${mp4Key}`);
}

// Rebuild the audio link (signed if GCS is on, local otherwise) and email it.
async function deliverAudio(job: AudioDeliveryJob): Promise<void> {
  let recordingUrl: string | null = null;
  let recordingExpiresAt: number | null = null;

  if (job.conversationId) {
    if (isGcsEnabled()) {
      const key = `recordings/${job.conversationId}.mp3`;
      recordingUrl = await withRetry(() => signedReadUrl(key), {
        label: `gcs-sign-audio-${job.sessionId}`,
      });
      recordingExpiresAt = Date.now() + SIGNED_URL_TTL_MS;
    } else {
      const rec = recordingPublicUrl(job.conversationId);
      recordingUrl = rec.url;
      recordingExpiresAt = rec.expiresAt;
    }
  }

  if (job.founder) {
    await withRetry(
      () =>
        sendFollowUpEmail({
          founder: job.founder!,
          sessionId: job.sessionId,
          roast: job.roast,
          recordingUrl,
          recordingExpiresAt,
          watchUrl: null,
          downloadUrl: null,
        }),
      { label: `email-audio-${job.sessionId}` },
    );
  }

  markDelivered(job.sessionId);
  console.log(`[delivery] audio delivered for ${job.sessionId}`);
}

async function updateSessionVideoKeys(
  sessionId: string,
  keys: {
    videoKey: string;
    vttKey: string | null;
    playerKey: string;
    hasCaptions: boolean;
    expiresAt: number;
  },
): Promise<void> {
  const col = sessionsCollection();
  if (!col) return;
  try {
    await col.updateOne(
      { session_id: sessionId },
      {
        $set: {
          video: {
            storage: 'gcs',
            video_key: keys.videoKey,
            vtt_key: keys.vttKey,
            player_key: keys.playerKey,
            has_captions: keys.hasCaptions,
            expires_at: new Date(keys.expiresAt),
          },
        },
      },
    );
  } catch (err) {
    console.error('[delivery] Atlas video-keys update failed:', err);
  }
}
