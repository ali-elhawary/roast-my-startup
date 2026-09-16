import 'dotenv/config';
import WebSocket from 'ws';

const KEY = process.env.ELEVENLABS_API_KEY!;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID!;

async function main() {
  // 1. Get a signed URL exactly like the app does.
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${AGENT_ID}`,
    { headers: { 'xi-api-key': KEY } },
  );
  if (!res.ok) {
    console.error('signed-url failed:', res.status, await res.text());
    process.exit(1);
  }
  const { signed_url } = (await res.json()) as { signed_url: string };
  console.log('got signed url OK');

  // 2. Connect to the conversation WebSocket and listen to the first events.
  const ws = new WebSocket(signed_url);
  const seen = new Set<string>();
  let gotAgentText = '';

  ws.on('open', () => {
    console.log('ws open -> sending conversation_initiation_client_data');
    ws.send(JSON.stringify({ type: 'conversation_initiation_client_data' }));
  });

  ws.on('message', (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    seen.add(msg.type);
    if (msg.type === 'agent_response') {
      gotAgentText = msg.agent_response_event?.agent_response ?? '';
      console.log('AGENT SAID:', JSON.stringify(gotAgentText));
    } else if (msg.type === 'audio') {
      const len = msg.audio_event?.audio_base_64?.length ?? 0;
      console.log(`audio chunk received (${len} b64 chars)`);
    } else if (msg.type === 'ping') {
      // keep-alive; respond so the socket stays healthy
      ws.send(JSON.stringify({ type: 'pong', event_id: msg.ping_event?.event_id }));
    } else {
      console.log('event:', msg.type);
    }
  });

  ws.on('error', (e) => console.error('ws error:', e));
  ws.on('close', (code) => console.log('ws closed', code));

  setTimeout(() => {
    console.log('\n--- summary ---');
    console.log('event types seen:', [...seen].join(', '));
    const ok = seen.has('conversation_initiation_metadata') && (seen.has('audio') || !!gotAgentText);
    console.log(ok ? 'AGENT LIVE + SPEAKING OK' : 'AGENT DID NOT START PROPERLY');
    ws.close();
    process.exit(ok ? 0 : 1);
  }, 8000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
