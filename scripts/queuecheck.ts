import 'dotenv/config';
import { connectDb, ensureIndexes, sessionsCollection } from '../server/db';
import { enqueueSessionWrite, flushQueue } from '../server/writeQueue';

async function main() {
  const db = await connectDb();
  if (!db) {
    console.error('Atlas not enabled.');
    process.exit(1);
  }
  await ensureIndexes();
  const col = sessionsCollection()!;

  const id = `test_queue_${Date.now()}`;
  console.log('enqueue failed-write simulation:', id);
  await enqueueSessionWrite({
    session_id: id,
    conversation_id: null,
    started_at: new Date(),
    completed_at: new Date(),
    duration_ms: 1000,
    source: 'fake',
    participant: { name: 'Q', email: 'q@x.com', consent_accepted_at: new Date() },
    answers: { building: 'a', audience: 'b', differentiation: 'c' },
    roast: { text: 't', category: 'devtools', source: 'generated' },
  });

  console.log('flushing queue...');
  await flushQueue();

  const found = await col.findOne({ session_id: id });
  console.log('doc landed in Atlas?', !!found);
  console.log('completed_at is Date?', found?.completed_at instanceof Date);

  const indexes = await col.listIndexes().toArray();
  const ttl = indexes.find((i: any) => i.name === 'session_ttl_90d');
  console.log('TTL index present?', !!ttl, '| expireAfterSeconds:', ttl?.expireAfterSeconds);

  const del = await col.deleteMany({ session_id: { $regex: '^test_queue_' } });
  console.log('cleaned up:', del.deletedCount);

  console.log(found && ttl ? '\nWRITE QUEUE + TTL OK' : '\nCHECK FAILED');
  process.exit(found && ttl ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
