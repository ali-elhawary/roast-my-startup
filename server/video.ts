// Video pipeline (Option 1: in-app capture). Source-agnostic on purpose: it
// takes a recorded file from anywhere (browser MediaRecorder now, an OBS
// adapter later) and turns it into a phone-playable MP4 + caption track, hosts
// it, records it on the session doc, and emails the founder a watch link.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import type { Founder, Roast } from '../shared/types';
import {
  fetchConversationAudioBuffer,
  fetchConversationDetails,
  type ConversationDetails,
  type TranscriptTurn,
} from './elevenlabs';
import { sessionsCollection } from './db';
import { sendFollowUpEmail } from './email';
import { isGcsEnabled } from './storage';
import { deliverVideo, markDelivered } from './delivery';
import { enqueueDelivery, type VideoDeliveryJob } from './deliveryQueue';

export const VIDEOS_DIR = path.resolve(process.cwd(), 'videos');
export const VIDEO_TTL_DAYS = 30;

const TRANSCRIPT_POLL_INTERVAL_MS = 8_000;
const TRANSCRIPT_MAX_ATTEMPTS = 10; // ~80s for the conversation to finalize

export type ProcessVideoInput = {
  sessionId: string;
  conversationId: string | null;
  sourceFile: string; // the uploaded recording (webm/mov/…)
  offsetMs: number; // conversationStart - recordStart, for caption alignment
  founder: Founder | null;
  roast: Roast | null;
};

export async function processSessionVideo(input: ProcessVideoInput): Promise<void> {
  await fs.mkdir(VIDEOS_DIR, { recursive: true });
  const mp4Path = path.join(VIDEOS_DIR, `${input.sessionId}.mp4`);
  const vttPath = path.join(VIDEOS_DIR, `${input.sessionId}.vtt`);
  const elAudioPath = path.join(VIDEOS_DIR, `${input.sessionId}.elaudio.mp3`);
  let wroteElAudio = false;

  try {
    const isReal = !!input.conversationId && !input.conversationId.startsWith('fake_');

    // 1. Wait for the conversation to finalize, then grab its recording (both
    // sides, mixed) + transcript.
    let details: ConversationDetails | null = null;
    if (isReal) details = await waitForConversation(input.conversationId!);

    // 2. Pull the ElevenLabs conversation audio to use as the video soundtrack.
    let audioSource: string | null = null;
    if (isReal && details?.hasAudio) {
      const buf = await fetchConversationAudioBuffer(input.conversationId!);
      if (buf) {
        await fs.writeFile(elAudioPath, buf);
        wroteElAudio = true;
        audioSource = elAudioPath;
      }
    }

    // 3. Transcode. Prefer the ElevenLabs conversation audio (agent + founder);
    // fall back to the camera's own mic track so a video is never lost.
    if (audioSource) {
      await transcodeWithExternalAudio(input.sourceFile, audioSource, mp4Path, input.offsetMs);
    } else {
      await transcode(input.sourceFile, mp4Path);
    }

    // 4. Captions from the transcript (chunked so they don't cover the frame).
    let hasCaptions = false;
    if (details && details.transcript.length) {
      await fs.writeFile(
        vttPath,
        buildVtt(details.transcript, input.offsetMs, details.callDurationSecs),
        'utf8',
      );
      hasCaptions = true;
    }

    // 5. Deliver. Cloud mode uploads to GCS and emails signed links, falling
    // back to the durable delivery queue on failure (keeping temp files so a
    // retry can re-upload). Local mode keeps hosting under /videos + /watch.
    if (isGcsEnabled()) {
      const job: VideoDeliveryJob = {
        kind: 'video',
        sessionId: input.sessionId,
        conversationId: input.conversationId,
        mp4Path,
        vttPath: hasCaptions ? vttPath : null,
        founder: input.founder,
        roast: input.roast,
        offsetMs: input.offsetMs,
      };
      try {
        await deliverVideo(job); // upload + signed links + Atlas keys + email
        // Delivered: the objects live in GCS now, drop the local temp files.
        await fs.unlink(mp4Path).catch(() => {});
        if (hasCaptions) await fs.unlink(vttPath).catch(() => {});
        console.log(
          `[video] cloud-delivered ${input.sessionId} (audio=${audioSource ? 'elevenlabs' : 'mic'}, captions=${hasCaptions})`,
        );
      } catch (err) {
        // Keep the temp mp4/vtt so the queued job can retry the upload, and do
        // NOT markDelivered — the audio fallback can still cover this session.
        console.error(
          `[video] cloud delivery failed for ${input.sessionId}, queuing for retry:`,
          err,
        );
        await enqueueDelivery(job);
      }
    } else {
      // Local mode (unchanged): host under /videos, email a /watch link.
      const base = (
        process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`
      ).replace(/\/$/, '');
      const watchUrl = `${base}/watch/${input.sessionId}`;
      const expiresAt = Date.now() + VIDEO_TTL_DAYS * 24 * 60 * 60 * 1000;

      // Record it on the session document.
      await updateSessionVideo(input.sessionId, watchUrl, expiresAt, hasCaptions);

      // Email the founder the watch link.
      if (input.founder) {
        await sendFollowUpEmail({
          founder: input.founder,
          sessionId: input.sessionId,
          roast: input.roast,
          recordingUrl: null,
          recordingExpiresAt: expiresAt,
          watchUrl,
        });
      }

      markDelivered(input.sessionId);
      console.log(
        `[video] ready for ${input.sessionId} (audio=${audioSource ? 'elevenlabs' : 'mic'}, captions=${hasCaptions}) -> ${watchUrl}`,
      );
    }
  } catch (err) {
    // Failed before producing a deliverable: log and leave the session
    // unmarked so the audio fallback (if armed) can still reach the founder.
    console.error(`[video] processing failed for ${input.sessionId}:`, err);
  } finally {
    await fs.unlink(input.sourceFile).catch(() => {});
    if (wroteElAudio) await fs.unlink(elAudioPath).catch(() => {});
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg binary not found'));
    const ff = spawn(ffmpegPath, args);
    let stderr = '';
    ff.stderr.on('data', (d) => (stderr += d.toString()));
    ff.on('error', reject);
    ff.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}

// Founder full-frame at 1080p. The /audience-style background lives on the watch
// PAGE (watchPage.ts), not baked into the video.
const VIDEO_ARGS = [
  '-c:v', 'libx264',
  '-preset', 'superfast', // booth turnaround > a few % of file size
  '-crf', '23',
  '-pix_fmt', 'yuv420p', // broad phone/browser compatibility
  '-vf', 'scale=-2:1080', // cap height at 1080p, keep aspect (even width)
  '-threads', '0', // use all cores
];
const AUDIO_ARGS = ['-c:a', 'aac', '-b:a', '128k'];

// Transcode using the camera recording's own audio (fallback path).
function transcode(input: string, output: string): Promise<void> {
  return runFfmpeg([
    '-y',
    '-i', input,
    ...VIDEO_ARGS,
    ...AUDIO_ARGS,
    '-movflags', '+faststart',
    output,
  ]);
}

// Mux: video from the camera recording + audio from the ElevenLabs conversation,
// aligned by offsetMs (conversationStart - recordStart).
function transcodeWithExternalAudio(
  videoInput: string,
  audioInput: string,
  output: string,
  offsetMs: number,
): Promise<void> {
  const offsetSec = offsetMs / 1000;
  const args = ['-y', '-i', videoInput];
  if (offsetSec >= 0) {
    // Conversation started after recording began: delay the audio.
    args.push('-itsoffset', offsetSec.toFixed(3), '-i', audioInput);
  } else {
    // Recording began after the conversation: skip the audio's early portion.
    args.push('-ss', Math.abs(offsetSec).toFixed(3), '-i', audioInput);
  }
  args.push(
    '-map', '0:v:0',
    '-map', '1:a:0',
    ...VIDEO_ARGS,
    ...AUDIO_ARGS,
    '-movflags', '+faststart',
    output,
  );
  return runFfmpeg(args);
}

async function waitForConversation(conversationId: string): Promise<ConversationDetails | null> {
  let last: ConversationDetails | null = null;
  for (let attempt = 0; attempt < TRANSCRIPT_MAX_ATTEMPTS; attempt++) {
    try {
      const details = await fetchConversationDetails(conversationId);
      if (details && details.status === 'done') {
        last = details;
        if (details.hasAudio) return details; // ideal: audio ready to mux
      }
    } catch (err) {
      console.error('[video] conversation poll failed:', err);
    }
    await sleep(TRANSCRIPT_POLL_INTERVAL_MS);
  }
  return last; // done-without-audio (mic fallback + captions) or null
}

const MAX_WORDS_PER_CUE = 12; // ~12 words per caption
const MIN_CUE_SEC = 0.8;
const WPM = 150; // caption pacing: words/min used to size each turn's window

// Turn the transcript into a WebVTT track, with timing driven by word count and
// non-overlap rather than the raw per-turn timestamps. ElevenLabs stamps the
// closing line earlier than the long roast actually finishes speaking, and the
// old code both bounded each turn by the NEXT turn's stamp AND stretched the LAST
// turn to the audio end — so "thanks for stopping by" appeared way too early and
// lingered while the roast cues raced ahead and died out. Now each turn gets a
// window sized by its words at WPM, anchored no earlier than the previous turn's
// end (a long roast pushes the closing line later), and clamped to the real audio
// length. Turn order is the only thing we trust from the transcript.
export function buildVtt(
  turns: TranscriptTurn[],
  offsetMs: number,
  callDurationSecs?: number | null,
): string {
  const offsetSec = offsetMs / 1000;
  const audioEnd = callDurationSecs != null ? callDurationSecs + offsetSec : null;
  const secPerWord = 60 / WPM;
  const lines = ['WEBVTT', ''];

  let prevEnd = 0;
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const words = turn.message.split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    // Anchor to the reported start, but never before the previous turn ended, so
    // a bad (too-early) stamp can't cram the prior turn or start this one early.
    const turnStart = Math.max(turn.timeInCallSecs + offsetSec, prevEnd);
    if (audioEnd != null && turnStart >= audioEnd) break; // no audio left to caption

    // Size the window by how long the words take to speak, clamped to audio end.
    let turnEnd = turnStart + Math.max(MIN_CUE_SEC, words.length * secPerWord);
    if (audioEnd != null) turnEnd = Math.min(turnEnd, audioEnd);
    const duration = Math.max(MIN_CUE_SEC, turnEnd - turnStart);

    const chunks = chunkWords(words, MAX_WORDS_PER_CUE);
    let cursor = turnStart;
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      const frac = chunk.wordCount / words.length;
      let cueEnd = cursor + Math.max(MIN_CUE_SEC, duration * frac);
      if (c === chunks.length - 1) cueEnd = turnEnd; // last chunk fills the window
      cueEnd = Math.min(turnEnd, cueEnd);
      if (cueEnd <= cursor) cueEnd = cursor + MIN_CUE_SEC;
      lines.push(`${fmtTime(cursor)} --> ${fmtTime(cueEnd)}`);
      lines.push(chunk.text);
      lines.push('');
      cursor = cueEnd;
    }
    prevEnd = turnEnd;
  }
  return lines.join('\n');
}

// Group words into ~maxWords chunks, breaking early at sentence/clause ends so
// cues fall on natural phrase boundaries.
function chunkWords(
  words: string[],
  maxWords: number,
): Array<{ text: string; wordCount: number }> {
  const chunks: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    const endsSentence = /[.!?]$/.test(w);
    const endsClause = /[,;:]$/.test(w);
    if (
      cur.length >= maxWords ||
      (endsSentence && cur.length >= 4) ||
      (endsClause && cur.length >= 7)
    ) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((c) => ({ text: c.join(' '), wordCount: c.length }));
}

function fmtTime(sec: number): string {
  const ms = Math.floor((sec % 1) * 1000);
  const s = Math.floor(sec) % 60;
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}`;
}

async function updateSessionVideo(
  sessionId: string,
  url: string,
  expiresAtMs: number,
  hasCaptions: boolean,
) {
  const col = sessionsCollection();
  if (!col) return;
  try {
    await col.updateOne(
      { session_id: sessionId },
      { $set: { video: { url, expires_at: new Date(expiresAtMs), has_captions: hasCaptions } } },
    );
  } catch (err) {
    console.error('[video] Atlas update failed:', err);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
