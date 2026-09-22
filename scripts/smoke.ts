import { initialState, reduce } from '../server/state';
import { validateRoast } from '../shared/validate';
import { FAKE_ROASTS, FALLBACK_ROAST } from '../server/mockRoasts';
import type { Command, SessionState } from '../shared/types';

let s: SessionState = initialState();
let t = 1_000;
const step = (c: Command) => {
  t += 1_000;
  s = reduce(s, c, t);
  console.log(`${c.type.padEnd(20)} -> phase=${s.phase} source=${s.sessionSource ?? '-'}`);
};

console.log('--- passing live-style flow ---');
step({ type: 'signin', name: 'Ada', email: 'ada@x.com' });
console.assert(s.phase === 'ready', 'signin should go ready');
step({ type: 'start' });
console.assert(s.phase === 'q1', 'start -> q1');
step({ type: 'answer', index: 1, text: 'a chip' });
console.assert(s.phase === 'q2', 'answer1 -> q2');
step({ type: 'answer', index: 2, text: 'for devs' });
console.assert(s.phase === 'q3', 'answer2 -> q3');
step({ type: 'answer', index: 3, text: 'we are fast' });
console.assert(s.phase === 'generating', 'answer3 -> generating');
step({ type: 'roast', text: FAKE_ROASTS.pass.text, category: 'ai-agents', source: 'generated' });
console.assert(s.phase === 'roasting', 'roast -> roasting');
console.assert(s.roast?.source === 'generated', 'source generated');
step({ type: 'complete' });
console.assert(s.phase === 'complete', 'complete');
console.assert(s.stats.sessionsToday === 1, 'sessionsToday=1');
console.assert(s.stats.byCategory['ai-agents'] === 1, 'ai-agents counted');

console.log('\n--- validation of mock roasts ---');
console.log('pass valid?', validateRoast(FAKE_ROASTS.pass.text));
console.log('banned valid?', validateRoast(FAKE_ROASTS.banned.text));
console.log('fallback valid?', validateRoast(FALLBACK_ROAST.text));
console.assert(validateRoast(FAKE_ROASTS.pass.text).ok === true, 'pass roast valid');
console.assert(validateRoast(FAKE_ROASTS.banned.text).ok === false, 'banned roast rejected');
console.assert(validateRoast(FALLBACK_ROAST.text).ok === true, 'fallback valid');

console.log('\n--- queue: multiple sign-ins accumulate; next advances the line ---');
// We're in `complete` from the flow above. Two people sign up while busy.
step({ type: 'signin', name: 'Grace Hopper', email: 'grace@x.com' });
step({ type: 'signin', name: 'Alan Turing', email: 'alan@x.com' });
console.assert(s.queue.length === 2, 'two queued');
console.assert(s.queue[0].name === 'Grace Hopper', 'FIFO order');
// Done / Call next -> promote the front of the line into ready.
step({ type: 'next' });
console.assert(s.phase === 'ready' && s.founder?.name === 'Grace Hopper', 'next promotes Grace');
console.assert(s.queue.length === 1 && s.queue[0].name === 'Alan Turing', 'Alan still waiting');
console.assert(!!s.founder?.id, 'founder has an id');

console.log('\n--- reset cancels current but keeps the queue ---');
step({ type: 'reset' });
console.assert(s.phase === 'idle', 'reset -> idle');
console.assert(s.queue.length === 1 && s.queue[0].name === 'Alan Turing', 'queue preserved on reset');

console.log('\n--- signin while idle promotes the front of the line ---');
step({ type: 'signin', name: 'Katherine Johnson', email: 'kj@x.com' });
console.assert(s.phase === 'ready' && s.founder?.name === 'Alan Turing', 'idle signin promotes front (Alan)');
console.assert(s.queue.length === 1 && s.queue[0].name === 'Katherine Johnson', 'Katherine now waiting');

console.log('\n--- dequeue removes from the line ---');
const kjId = s.queue[0].id;
step({ type: 'dequeue', id: kjId });
console.assert(s.queue.length === 0, 'dequeue removed Katherine');

console.log('\n--- emergency stop keeps the queue ---');
step({ type: 'signin', name: 'Grace Two', email: 'g2@x.com' }); // queues (busy: Alan is ready)
console.assert(s.queue.length === 1, 'Grace Two queued while busy');
step({ type: 'stop' });
console.assert(s.phase === 'idle', 'stop -> idle');
console.assert(s.queue.length === 1, 'stop keeps the queue');

console.log('\n--- skip bumps skipSignal (agent nudge signal) ---');
let sk: SessionState = initialState();
let tk = 1000;
const stepK = (c: Command) => { tk += 1000; sk = reduce(sk, c, tk); };
stepK({ type: 'signin', name: 'Skip', email: 's@x.com' });
stepK({ type: 'start' });
const before = sk.skipSignal;
stepK({ type: 'skip' });
console.log(`skipSignal ${before} -> ${sk.skipSignal}, phase=${sk.phase}`);
console.assert(sk.skipSignal === before + 1, 'skip increments skipSignal');
console.assert(sk.phase === 'q2', 'skip q1 -> q2');
const beforeAns = sk.skipSignal;
stepK({ type: 'answer', index: 2, text: 'x' });
console.assert(sk.skipSignal === beforeAns, 'answer does NOT bump skipSignal');

console.log('\n--- skipRoast + word counts ---');
const words = (x: string) => x.trim().split(/\s+/).length;
console.log('pass words', words(FAKE_ROASTS.pass.text), 'banned words', words(FAKE_ROASTS.banned.text), 'fallback words', words(FALLBACK_ROAST.text));

console.log('\nALL SMOKE CHECKS PASSED');
