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

    // 5. Watch link + expiry.
    const base = (
      process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`
    ).replace(/\/$/, '');
    const watchUrl = `${base}/watch/${input.sessionId}`;
    const expiresAt = Date.now() + VIDEO_TTL_DAYS * 24 * 60 * 60 * 1000;

    // 6. Record it on the session document.
    await updateSessionVideo(input.sessionId, watchUrl, expiresAt, hasCaptions);

    // 7. Email the founder the watch link.
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

    console.log(
      `[video] ready for ${input.sessionId} (audio=${audioSource ? 'elevenlabs' : 'mic'}, captions=${hasCaptions}) -> ${watchUrl}`,
    );
  } catch (err) {
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

const VIDEO_ARGS = [
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '23',
  '-vf', 'scale=-2:720', // cap height at 720p, keep aspect (even width)
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

// Mux: video track from the camera recording + audio from the ElevenLabs
// conversation recording, aligned by offsetMs (conversationStart - recordStart).
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
const WPM = 150; // fallback pacing for the last turn (no next-turn boundary)

// Turn the transcript into a WebVTT track. Each turn is split into short cues
// spread across the turn's time window, so captions change every couple seconds
// instead of dumping a whole paragraph on the frame. The LAST turn (the roast)
// is bounded to the real audio end (callDurationSecs) so its captions track the
// spoken pace instead of racing ahead on a word-count estimate.
export function buildVtt(
  turns: TranscriptTurn[],
  offsetMs: number,
  callDurationSecs?: number | null,
): string {
  const offsetSec = offsetMs / 1000;
  const audioEnd = callDurationSecs != null ? callDurationSecs + offsetSec : null;
  const lines = ['WEBVTT', ''];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const words = turn.message.split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    const turnStart = Math.max(0, turn.timeInCallSecs + offsetSec);
    const isLast = i + 1 >= turns.length;
    const nextStart = !isLast ? turns[i + 1].timeInCallSecs + offsetSec : null;
    // Last turn: end at the real audio end when known; otherwise estimate.
    const estDur = Math.max(MIN_CUE_SEC, (words.length / WPM) * 60);
    const turnEnd = !isLast
      ? Math.max(turnStart + MIN_CUE_SEC, nextStart!)
      : audioEnd != null
        ? Math.max(turnStart + MIN_CUE_SEC, audioEnd)
        : turnStart + estDur;
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
