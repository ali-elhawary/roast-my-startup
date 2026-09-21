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

  try {
    // 1. Transcode to a web/phone-friendly MP4 (H.264 + AAC, faststart, 720p).
    await transcode(input.sourceFile, mp4Path);

    // 2. Captions from the ElevenLabs transcript (needs the conversation done).
    let hasCaptions = false;
    if (input.conversationId && !input.conversationId.startsWith('fake_')) {
      const details = await waitForTranscript(input.conversationId);
      if (details && details.transcript.length) {
        await fs.writeFile(vttPath, buildVtt(details.transcript, input.offsetMs), 'utf8');
        hasCaptions = true;
      }
    }

    // 3. Build the watch link + expiry.
    const base = (
      process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`
    ).replace(/\/$/, '');
    const watchUrl = `${base}/watch/${input.sessionId}`;
    const expiresAt = Date.now() + VIDEO_TTL_DAYS * 24 * 60 * 60 * 1000;

    // 4. Record it on the session document.
    await updateSessionVideo(input.sessionId, watchUrl, expiresAt, hasCaptions);

    // 5. Email the founder the watch link.
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

    console.log(`[video] ready for ${input.sessionId} (captions=${hasCaptions}) -> ${watchUrl}`);
  } catch (err) {
    console.error(`[video] processing failed for ${input.sessionId}:`, err);
  } finally {
    // Drop the raw upload; keep only the transcoded MP4.
    await fs.unlink(input.sourceFile).catch(() => {});
  }
}

function transcode(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg binary not found'));
    const args = [
      '-y',
      '-i', input,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-vf', 'scale=-2:720', // cap height at 720p, keep aspect (even width)
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      output,
    ];
    const ff = spawn(ffmpegPath, args);
    let stderr = '';
    ff.stderr.on('data', (d) => (stderr += d.toString()));
    ff.on('error', reject);
    ff.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}

async function waitForTranscript(conversationId: string): Promise<ConversationDetails | null> {
  for (let attempt = 0; attempt < TRANSCRIPT_MAX_ATTEMPTS; attempt++) {
    try {
      const details = await fetchConversationDetails(conversationId);
      if (details && details.status === 'done' && details.transcript.length) return details;
    } catch (err) {
      console.error('[video] transcript poll failed:', err);
    }
    await sleep(TRANSCRIPT_POLL_INTERVAL_MS);
  }
  return null;
}

// Turn the transcript into a WebVTT track. Each turn becomes a cue from its
// time_in_call_secs (shifted into video time by offsetMs) to the next turn's
// start. Speaker-labelled so the founder can tell who's talking.
export function buildVtt(turns: TranscriptTurn[], offsetMs: number): string {
  const offsetSec = offsetMs / 1000;
  const lines = ['WEBVTT', ''];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const start = Math.max(0, turn.timeInCallSecs + offsetSec);
    const nextStart =
      i + 1 < turns.length ? turns[i + 1].timeInCallSecs + offsetSec : start + 6;
    const end = Math.max(start + 1.2, nextStart);
    const who = turn.role === 'agent' ? 'Host' : 'You';
    lines.push(`${fmtTime(start)} --> ${fmtTime(end)}`);
    lines.push(`<v ${who}>${turn.message}`);
    lines.push('');
  }
  return lines.join('\n');
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
