import WebSocket from 'ws';

const PORT = process.env.PORT || 3001;
const ws = new WebSocket(`ws://localhost:${PORT}/ws`);

ws.on('open', async () => {
  console.log('[ws] open');
  const res = await fetch(`http://localhost:${PORT}/api/dev/fake-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variant: 'banned' }),
  });
  console.log('[http] fake-session ->', res.status, await res.text());
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'state') {
    const s = msg.state;
    console.log(`[state] phase=${s.phase} source=${s.sessionSource ?? '-'} founder=${s.founder?.name ?? '-'} roastSrc=${s.roast?.source ?? '-'}`);
  }
});

ws.on('error', (e) => console.error('[ws] error', e));

// Watch the first ~11s of the fake session, then exit.
setTimeout(() => {
  console.log('[done]');
  ws.close();
  process.exit(0);
}, 11_000);
