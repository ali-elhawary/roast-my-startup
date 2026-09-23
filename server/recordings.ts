// Saves conversation recordings to disk and builds a link for the email.
//
// This is a booth-grade host: the Node server serves /recordings statically on
// the local network. For production, swap saveRecording to upload to S3/GCS and
// return a signed URL that expires with RECORDING_TTL_DAYS.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const RECORDINGS_DIR = path.resolve(process.cwd(), 'recordings');
export const RECORDING_TTL_DAYS = 30; // brief: audio retained 30 days

export type SavedRecording = { url: string; expiresAt: number; filePath: string };

export async function saveRecording(
  conversationId: string,
  buffer: Buffer,
): Promise<SavedRecording> {
  await fs.mkdir(RECORDINGS_DIR, { recursive: true });
  const fileName = `${conversationId}.mp3`;
  const filePath = path.join(RECORDINGS_DIR, fileName);
  await fs.writeFile(filePath, buffer);

  const { url, expiresAt } = recordingPublicUrl(conversationId);
  return { url, expiresAt, filePath };
}

// Build the local (LAN) URL + expiry for a saved recording without touching
// disk. Used by the delivery fallback to (re)build the audio link at send time.
export function recordingPublicUrl(conversationId: string): {
  url: string;
  expiresAt: number;
} {
  const base =
    process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
  const url = `${base.replace(/\/$/, '')}/recordings/${conversationId}.mp3`;
  const expiresAt = Date.now() + RECORDING_TTL_DAYS * 24 * 60 * 60 * 1000;
  return { url, expiresAt };
}
