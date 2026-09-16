import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { connectDb, sessionsCollection } from '../server/db';
import { RECORDINGS_DIR } from '../server/recordings';

const PORT = process.env.TARGET_PORT || process.env.PORT || 3001;
const TOKEN = process.env.ADMIN_TOKEN;
const URL = `http://localhost:${PORT}/api/admin/delete`;

async function main() {
  await connectDb();
  const col = sessionsCollection()!;

  const cid = `fake_del_${Date.now()}`; // fake_ => skips ElevenLabs delete
  const sid = `test_del_${Date.now()}`;
  const email = `del_${Date.now()}@test.com`;

  await col.insertOne({
    session_id: sid,
    conversation_id: cid,
    completed_at: new Date(),
    participant: { name: 'Delete Me', email, consent_accepted_at: new Date() },
    roast: { text: 'x', category: 'devtools', source: 'generated' },
  });
  await fs.mkdir(RECORDINGS_DIR, { recursive: true });
  const file = path.join(RECORDINGS_DIR, `${cid}.mp3`);
  await fs.writeFile(file, Buffer.from('fake-audio-bytes'));
  console.log('setup doc:', sid, '| file:', path.basename(file));

  const post = (headers: Record<string, string>) =>
    fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ email }),
    });

  const noToken = await post({});
  console.log('no-token   ->', noToken.status);
  const wrong = await post({ 'x-admin-token': 'nope' });
  console.log('wrong-token->', wrong.status);
  const ok = await post({ 'x-admin-token': TOKEN! });
  const summary = await ok.json();
  console.log('valid-token->', ok.status, JSON.stringify(summary));

  const still = await col.findOne({ session_id: sid });
  const fileGone = !(await fs.stat(file).catch(() => null));
  console.log('doc gone?', !still, '| file gone?', fileGone);

  const pass =
    noToken.status === 401 &&
    wrong.status === 401 &&
    ok.status === 200 &&
    summary.sessionsDeleted === 1 &&
    summary.recordingsDeleted === 1 &&
    !still &&
    fileGone;
  console.log(pass ? '\nDELETION PATH OK' : '\nCHECK FAILED');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
