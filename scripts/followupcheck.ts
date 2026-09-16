import 'dotenv/config';
import { promises as fs } from 'node:fs';
import {
  fetchConversationDetails,
  fetchConversationAudioBuffer,
  transcriptToText,
} from '../server/elevenlabs';
import { saveRecording } from '../server/recordings';
import { sendFollowUpEmail } from '../server/email';

const CID = process.argv[2] || 'conv_3601m2nxbsx1e9xr9nfcvkr1c8bq';

async function main() {
  console.log('conversation:', CID);

  const details = await fetchConversationDetails(CID);
  if (!details) {
    console.error('could not fetch details');
    process.exit(1);
  }
  console.log('status:', details.status, '| hasAudio:', details.hasAudio, '| turns:', details.transcript.length);

  const transcript = transcriptToText(details.transcript);
  console.log('\n--- transcript (first 300 chars) ---\n', transcript.slice(0, 300));

  const audio = await fetchConversationAudioBuffer(CID);
  console.log('\naudio bytes:', audio?.length ?? 0);
  let rec = null;
  if (audio) {
    rec = await saveRecording(CID, audio);
    const stat = await fs.stat(rec.filePath);
    console.log('saved recording:', rec.filePath, `(${stat.size} bytes)`);
    console.log('recording url:', rec.url, '| expires:', new Date(rec.expiresAt).toDateString());
  }

  await sendFollowUpEmail({
    founder: { name: 'Fernwood Founder', email: 'founder@fernwood.example', consentAt: Date.now() },
    sessionId: 'test-session',
    roast: { text: 'You cut fifteen hours to forty minutes, which is genuinely impressive. But your market is everyone with a security questionnaire, which is nobody in particular. Pick a wedge.', category: 'ai-agents', source: 'generated' },
    recordingUrl: rec?.url ?? null,
    recordingExpiresAt: rec?.expiresAt ?? null,
  });

  const outbox = await fs.readdir('outbox').catch(() => []);
  console.log('\noutbox files:', outbox);
  console.log('\nFOLLOWUP PIPELINE OK');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
