import 'dotenv/config';

// Sets the agent's conversation retention to 30 days (brief: audio retained 30
// days, then deleted). Session docs + transcripts live 90 days in Atlas via the
// TTL index; this governs ElevenLabs-side data only.

const API = 'https://api.elevenlabs.io/v1/convai';
const KEY = process.env.ELEVENLABS_API_KEY!;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID!;
const RETENTION_DAYS = 30;

async function main() {
  const res = await fetch(`${API}/agents/${AGENT_ID}`, {
    method: 'PATCH',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform_settings: { privacy: { retention_days: RETENTION_DAYS } },
    }),
  });
  if (!res.ok) {
    console.error('patch failed:', res.status, await res.text());
    process.exit(1);
  }

  const check = await fetch(`${API}/agents/${AGENT_ID}`, {
    headers: { 'xi-api-key': KEY },
  });
  const d = (await check.json()) as any;
  const priv = d.platform_settings?.privacy ?? {};
  console.log('record_voice:', priv.record_voice);
  console.log('retention_days:', priv.retention_days);
  console.log(priv.retention_days === RETENTION_DAYS ? 'RETENTION SET' : 'RETENTION NOT APPLIED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
