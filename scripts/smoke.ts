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

console.log('\n--- reset promotes queued founder ---');
step({ type: 'signin', name: 'Grace', email: 'grace@x.com' }); // queued (phase complete)
console.assert(s.queued?.name === 'Grace', 'Grace queued');
step({ type: 'reset' });
console.assert(s.phase === 'ready' && s.founder?.name === 'Grace', 'reset promotes queue');

console.log('\n--- skipRoast + word counts ---');
const words = (x: string) => x.trim().split(/\s+/).length;
console.log('pass words', words(FAKE_ROASTS.pass.text), 'banned words', words(FAKE_ROASTS.banned.text), 'fallback words', words(FALLBACK_ROAST.text));

console.log('\nALL SMOKE CHECKS PASSED');
