// Server-side fake session. It does NOT manipulate phase directly — it
// dispatches the same command messages a real client would, on a realistic
// schedule, so the dev flow shares every line of transition logic with the
// live ElevenLabs flow. The only difference is where the commands originate.

import type { Command } from '../shared/types';
import { validateRoast } from '../shared/validate';
import { QUESTIONS } from '../shared/constants';
import {
  FAKE_ANSWERS,
  FAKE_FOUNDER,
  FAKE_ROASTS,
  FALLBACK_ROAST,
} from './mockRoasts';

const FAKE_CLOSING =
  "That's your roast — the recording's on its way to your inbox. Ask us about MongoDB for Startups on your way out.";

export type FakeVariant = 'pass' | 'banned';

let timers: ReturnType<typeof setTimeout>[] = [];

export function cancelFakeSession() {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

export function runFakeSession(
  variant: FakeVariant,
  dispatch: (command: Command) => void,
) {
  cancelFakeSession();

  const at = (ms: number, action: Command | (() => void)) => {
    timers.push(
      setTimeout(() => {
        if (typeof action === 'function') action();
        else dispatch(action);
      }, ms),
    );
  };

  const roast = variant === 'banned' ? FAKE_ROASTS.banned : FAKE_ROASTS.pass;
  const spokenRoast = validateRoast(roast.text).ok ? roast.text : FALLBACK_ROAST.text;

  // Transcript feed helper (mirrors the live agent's onMessage relay).
  const say = (role: 'user' | 'agent', text: string) =>
    dispatch({ type: 'transcriptTurn', role, text });

  at(0, {
    type: 'signin',
    name: FAKE_FOUNDER.name,
    email: FAKE_FOUNDER.email,
    company: FAKE_FOUNDER.company,
    source: 'fake',
  });
  at(2_000, { type: 'start' });
  at(2_200, { type: 'conversationStarted', conversationId: `fake_${Date.now()}` });

  // Q1
  at(3_000, () => say('agent', QUESTIONS[0]));
  at(7_000, () => say('user', FAKE_ANSWERS.building));
  at(8_000, { type: 'answer', index: 1, text: FAKE_ANSWERS.building });
  // Q2
  at(12_000, () => say('agent', QUESTIONS[1]));
  at(19_000, () => say('user', FAKE_ANSWERS.audience));
  at(20_000, { type: 'answer', index: 2, text: FAKE_ANSWERS.audience });
  // Q3
  at(26_000, () => say('agent', QUESTIONS[2]));
  at(34_000, () => say('user', FAKE_ANSWERS.differentiation));
  at(35_000, { type: 'answer', index: 3, text: FAKE_ANSWERS.differentiation });

  at(40_000, () => {
    // Validate here exactly as the client-side deliverRoast tool would, and
    // fall back to a generic roast (source 'fallback') when it fails.
    dispatch({
      type: 'roast',
      text: spokenRoast,
      category: roast.category,
      source: spokenRoast === roast.text ? 'generated' : 'fallback',
    });
  });
  // The roaster speaks the roast, then the closing line (feeds the transcript).
  at(41_000, () => say('agent', spokenRoast));
  at(60_000, () => say('agent', FAKE_CLOSING));
  at(95_000, { type: 'complete' });
}
