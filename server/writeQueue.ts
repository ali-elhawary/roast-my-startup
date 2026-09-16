// Durable local retry queue for session writes. An Atlas write must never block
// the founder: on failure the document is written to ./.write-queue as JSON and
// a background flusher retries it until it lands. Survives a server restart.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sessionsCollection } from './db';

const QUEUE_DIR = path.resolve(process.cwd(), '.write-queue');
const FLUSH_INTERVAL_MS = 15_000;

// Fields stored as Dates in Mongo; JSON serialization turns them into strings,
// so revive them before re-inserting (the TTL index needs a real Date).
const DATE_PATHS = [
  ['completed_at'],
  ['started_at'],
  ['participant', 'consent_accepted_at'],
  ['recording', 'expires_at'],
] as const;

function reviveDates(doc: Record<string, any>) {
  for (const p of DATE_PATHS) {
    let obj: any = doc;
    for (let i = 0; i < p.length - 1; i++) obj = obj?.[p[i]];
    const key = p[p.length - 1];
    if (obj && typeof obj[key] === 'string') obj[key] = new Date(obj[key]);
  }
  return doc;
}

export async function enqueueSessionWrite(doc: Record<string, unknown>) {
  try {
    await fs.mkdir(QUEUE_DIR, { recursive: true });
    const id = (doc.session_id as string) || `s_${Date.now()}`;
    await fs.writeFile(
      path.join(QUEUE_DIR, `${id}.json`),
      JSON.stringify(doc),
      'utf8',
    );
    console.log(`[writeQueue] queued ${id} for retry`);
  } catch (err) {
    console.error('[writeQueue] failed to persist doc for retry:', err);
  }
}

export async function flushQueue(): Promise<void> {
  const col = sessionsCollection();
  if (!col) return; // Atlas still unavailable

  let files: string[];
  try {
    files = await fs.readdir(QUEUE_DIR);
  } catch {
    return; // queue dir doesn't exist yet — nothing pending
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(QUEUE_DIR, file);
    try {
      const doc = reviveDates(JSON.parse(await fs.readFile(filePath, 'utf8')));
      await col.insertOne(doc);
      await fs.unlink(filePath);
      console.log(`[writeQueue] flushed ${file}`);
    } catch (err) {
      // Still failing (Atlas down, or duplicate). Stop and retry next cycle.
      console.error(`[writeQueue] ${file} still pending:`, err);
      break;
    }
  }
}

export function startQueueFlusher() {
  setInterval(() => {
    void flushQueue();
  }, FLUSH_INTERVAL_MS);
}
