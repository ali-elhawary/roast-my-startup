// Optional MongoDB Atlas connection. If MONGODB_URI is unset, Atlas is disabled
// and the app runs entirely in memory (unchanged behavior). A bad URI must not
// crash the booth — connect failures are caught and Atlas stays disabled.

import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

export function isAtlasEnabled(): boolean {
  return !!process.env.MONGODB_URI;
}

export async function connectDb(): Promise<Db | null> {
  if (!isAtlasEnabled()) return null;
  if (db) return db;
  try {
    client = new MongoClient(process.env.MONGODB_URI!, {
      serverSelectionTimeoutMS: 5000,
    });
    await client.connect();
    db = client.db(process.env.MONGODB_DB || 'roast_my_startup');
    console.log('[db] connected to Atlas');
    return db;
  } catch (err) {
    console.error('[db] Atlas connection failed, continuing in-memory:', err);
    client = null;
    db = null;
    return null;
  }
}

export function sessionsCollection(): Collection<Document> | null {
  return db ? db.collection('sessions') : null;
}

// Session documents and transcripts are retained 90 days, then deleted (brief).
// A TTL index on completed_at lets Atlas expire them automatically.
export const SESSION_TTL_DAYS = 90;

export async function ensureIndexes(): Promise<void> {
  const col = sessionsCollection();
  if (!col) return;
  try {
    await col.createIndex(
      { completed_at: 1 },
      { expireAfterSeconds: SESSION_TTL_DAYS * 24 * 60 * 60, name: 'session_ttl_90d' },
    );
    console.log(`[db] TTL index ensured (${SESSION_TTL_DAYS}d on completed_at)`);
  } catch (err) {
    // A conflicting index (different expiry) needs a manual collMod — log and go.
    console.error('[db] could not ensure TTL index:', err);
  }
}

// Aggregate today's sessions into the shape the /panel screen consumes. Runs on
// startup so the count survives a server restart. Returns null when Atlas is off.
export async function aggregateTodayStats(): Promise<
  { sessionsToday: number; byCategory: Record<string, number> } | null
> {
  const col = sessionsCollection();
  if (!col) return null;

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const rows = await col
    .aggregate([
      { $match: { completed_at: { $gte: start } } },
      { $group: { _id: '$roast.category', count: { $sum: 1 } } },
    ])
    .toArray();

  const byCategory: Record<string, number> = {};
  let sessionsToday = 0;
  for (const row of rows) {
    const count = Number(row.count) || 0;
    sessionsToday += count;
    const category = typeof row._id === 'string' && row._id ? row._id : null;
    if (category) byCategory[category] = count;
  }
  return { sessionsToday, byCategory };
}
