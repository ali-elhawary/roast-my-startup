// Durable, disk-backed retry queue for FINAL delivery jobs (upload + email),
// mirroring writeQueue.ts. When a cloud delivery fails after its in-line
// retries, enough info to re-run it is written to ./.delivery-queue as JSON and
// a background flusher retries it until it lands. Survives a server restart.
//
// A job carries everything runDelivery() needs to re-run the delivery:
//   - video: the local mp4/vtt temp files (which the caller must NOT delete
//     while a job is queued) plus founder/roast so the email can be rebuilt.
//   - audio: conversation id + founder/roast; the recording link is rebuilt
//     (signed or local) at send time.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Founder, Roast } from '../shared/types';
import { runDelivery } from './delivery';

const QUEUE_DIR = path.resolve(process.cwd(), '.delivery-queue');
const FLUSH_INTERVAL_MS = 30_000;

export type VideoDeliveryJob = {
  kind: 'video';
  sessionId: string;
  conversationId: string | null;
  mp4Path: string;
  vttPath: string | null;
  founder: Founder | null;
  roast: Roast | null;
  offsetMs: number;
};

export type AudioDeliveryJob = {
  kind: 'audio';
  sessionId: string;
  conversationId: string | null;
  founder: Founder | null;
  roast: Roast | null;
};

export type DeliveryJob = VideoDeliveryJob | AudioDeliveryJob;

export async function enqueueDelivery(job: DeliveryJob): Promise<void> {
  try {
    await fs.mkdir(QUEUE_DIR, { recursive: true });
    const id = `${job.kind}-${job.sessionId}-${Date.now()}`;
    await fs.writeFile(path.join(QUEUE_DIR, `${id}.json`), JSON.stringify(job), 'utf8');
    console.log(`[deliveryQueue] queued ${job.kind} delivery for ${job.sessionId}`);
  } catch (err) {
    console.error('[deliveryQueue] failed to persist job for retry:', err);
  }
}

export async function flushDeliveryQueue(): Promise<void> {
  let files: string[];
  try {
    files = await fs.readdir(QUEUE_DIR);
  } catch {
    return; // queue dir doesn't exist yet — nothing pending
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(QUEUE_DIR, file);

    let job: DeliveryJob;
    try {
      job = JSON.parse(await fs.readFile(filePath, 'utf8')) as DeliveryJob;
    } catch (err) {
      // Corrupt/unreadable job file — drop it rather than looping forever.
      console.error(`[deliveryQueue] ${file} unreadable, removing:`, err);
      await fs.unlink(filePath).catch(() => {});
      continue;
    }

    try {
      await runDelivery(job);
      await fs.unlink(filePath).catch(() => {});
      await cleanupTempFiles(job);
      console.log(`[deliveryQueue] delivered ${file}`);
    } catch (err) {
      // Still failing (cloud down, SMTP down). Leave it and try again next
      // cycle. Jobs are independent, so keep going with the rest.
      console.error(`[deliveryQueue] ${file} still pending:`, err);
    }
  }
}

// Once a video job is delivered its local temp files are no longer needed.
async function cleanupTempFiles(job: DeliveryJob): Promise<void> {
  if (job.kind !== 'video') return;
  await fs.unlink(job.mp4Path).catch(() => {});
  if (job.vttPath) await fs.unlink(job.vttPath).catch(() => {});
}

export function startDeliveryFlusher(): void {
  setInterval(() => {
    void flushDeliveryQueue();
  }, FLUSH_INTERVAL_MS);
}
