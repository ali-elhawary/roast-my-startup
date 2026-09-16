import WebSocket from 'ws';

const PORT = process.env.PORT || 3001;
const ws = new WebSocket(`ws://localhost:${PORT}/ws`);

type S = {
  phase: string;
  paused: boolean;
  skipSignal: number;
  sessionSource: string | null;
};
let last: S | null = null;
const log = (label: string) =>
  console.log(
    `${label.padEnd(22)} phase=${last?.phase} paused=${last?.paused} skipSignal=${last?.skipSignal}`,
  );

function send(c: unknown) {
  ws.send(JSON.stringify(c));
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'state') last = msg.state;
});

ws.on('open', async () => {
  await wait(200);
  send({ type: 'reset' }); // clean slate
  await wait(150);
  send({ type: 'signin', name: 'Sync Test', email: 'sync@x.com' });
  await wait(150);
  send({ type: 'start' });
  await wait(150);
  log('after start');
  const skip0 = last!.skipSignal;

  send({ type: 'skip' });
  await wait(150);
  log('after skip #1');
  console.assert(last!.phase === 'q2', 'skip -> q2');
  console.assert(last!.skipSignal === skip0 + 1, 'skipSignal +1');

  send({ type: 'skip' });
  await wait(150);
  log('after skip #2');
  console.assert(last!.phase === 'q3', 'skip -> q3');
  console.assert(last!.skipSignal === skip0 + 2, 'skipSignal +2');

  send({ type: 'pause' });
  await wait(150);
  log('after pause');
  console.assert(last!.paused === true, 'pause sets paused=true');

  send({ type: 'resume' });
  await wait(150);
  log('after resume');
  console.assert(last!.paused === false, 'resume sets paused=false');

  // Answer after skips should NOT bump skipSignal.
  const beforeAns = last!.skipSignal;
  send({ type: 'answer', index: 3, text: 'because we win' });
  await wait(150);
  log('after answer');
  console.assert(last!.skipSignal === beforeAns, 'answer does not bump skipSignal');

  send({ type: 'reset' });
  await wait(150);

  console.log('\nSYNC SIGNALS OK (skipSignal + paused broadcast correctly)');
  ws.close();
  process.exit(0);
});

ws.on('error', (e) => {
  console.error('ws error:', e);
  process.exit(1);
});
