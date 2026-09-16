import 'dotenv/config';
import { connectDb, sessionsCollection, aggregateTodayStats } from '../server/db';

async function main() {
  const db = await connectDb();
  if (!db) {
    console.error('Atlas not enabled (MONGODB_URI unset) or connect failed.');
    process.exit(1);
  }
  const col = sessionsCollection()!;

  const testId = `test_${Date.now()}`;
  console.log('inserting test doc', testId);
  await col.insertOne({
    session_id: testId,
    conversation_id: null,
    started_at: new Date(),
    completed_at: new Date(),
    duration_ms: 1234,
    source: 'fake',
    participant: { name: 'Atlas Check', email: 'check@example.com', consent_accepted_at: new Date() },
    answers: { building: 'x', audience: 'y', differentiation: 'z' },
    roast: { text: 'test', category: 'devtools', source: 'generated' },
  });

  const stats = await aggregateTodayStats();
  console.log('aggregateTodayStats ->', JSON.stringify(stats));

  const readBack = await col.findOne({ session_id: testId });
  console.log('read back ok?', !!readBack);

  const del = await col.deleteMany({ session_id: { $regex: '^test_' } });
  console.log('cleaned up test docs:', del.deletedCount);

  console.log('\nATLAS WRITE + READ + AGGREGATE OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('ATLAS CHECK FAILED:', err);
  process.exit(1);
});
