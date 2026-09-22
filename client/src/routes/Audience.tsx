import { useEffect, useMemo, useState } from 'react';
import { useSession } from '@/lib/ws';
import { useNow } from '@/lib/useNow';
import { Brand } from '@/lib/Brand';
import { computeRevealSchedule, splitSentences } from '@/lib/reveal';
import { QUESTIONS } from '@shared/constants';
import type { SessionState } from '@shared/types';

// The most important screen. Read from 6-10 feet. Nothing smaller than 24px;
// roast text 48px+.
export default function Audience() {
  const { state } = useSession();
  if (!state) return <Center>Connecting&hellip;</Center>;

  let content: React.ReactNode;
  switch (state.phase) {
    case 'ready':
    case 'q1':
    case 'q2':
    case 'q3':
      content = <Questions state={state} />;
      break;
    case 'generating':
      content = <Generating />;
      break;
    case 'roasting':
      content = <Roasting state={state} />;
      break;
    case 'complete':
      content = <RoastCard state={state} />;
      break;
    case 'idle':
    default:
      content = <Attract />;
  }

  return (
    <>
      {content}
      <NextUp state={state} />
    </>
  );
}

function NextUp({ state }: { state: SessionState }) {
  if (state.queue.length === 0) return null;
  const firstName = state.queue[0].name.trim().split(/\s+/)[0];
  return (
    <div className="fixed bottom-4 right-4 z-10 rounded-full bg-ink-800/85 px-5 py-2 text-2xl">
      <span className="text-ink-400">Next up: </span>
      <span className="font-bold text-ink-100">{firstName}</span>
      <span className="text-ink-400"> &middot; {state.queue.length} in line</span>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-3xl text-ink-400">
      {children}
    </div>
  );
}

const ATTRACT_LINES = [
  '"A moat made entirely of vibes."',
  '"You said AI eleven times and product zero."',
  '"Your TAM is everyone, which means it\u2019s no one."',
  '"Bold of you to charge for a feature Gmail ships free."',
  '"The deck says pre-revenue. The roast says pre-idea."',
  '"Great logo. Now what does it do?"',
];

function Attract() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % ATTRACT_LINES.length), 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex h-full flex-col justify-between px-16 py-14">
      <Brand className="text-2xl" />
      <div>
        <h1 className="max-w-5xl text-7xl font-black leading-[1.05] tracking-tight text-balance">
          Tell us what you&rsquo;re building.
          <br />
          Get <span className="text-accent">roasted</span> in two minutes.
        </h1>
        <div className="mt-12 h-16">
          <p
            key={i}
            className="text-4xl text-ink-200"
            style={{ animation: 'fadeInOut 4s ease-in-out' }}
          >
            {ATTRACT_LINES[i]}
          </p>
        </div>
      </div>
      <div className="text-2xl text-ink-400">
        Sign in at the tablet &rarr; take the chair &rarr; brace yourself.
      </div>
    </div>
  );
}

function Questions({ state }: { state: SessionState }) {
  const activeIndex =
    state.phase === 'q1' ? 0 : state.phase === 'q2' ? 1 : state.phase === 'q3' ? 2 : -1;
  const answers = [state.answers.building, state.answers.audience, state.answers.differentiation];

  return (
    <div className="flex h-full flex-col justify-center px-16">
      <Brand className="mb-12 text-xl" />
      <ul className="space-y-8">
        {QUESTIONS.map((q, idx) => {
          const done = activeIndex === -1 ? false : idx < activeIndex;
          const active = idx === activeIndex;
          const answer = answers[idx]?.slice(0, 60);
          return (
            <li key={q} className="flex items-start gap-6">
              <span
                className={`mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl font-bold ${
                  active
                    ? 'bg-accent text-ink-900'
                    : done
                      ? 'bg-accent/20 text-accent'
                      : 'bg-ink-700 text-ink-400'
                }`}
              >
                {idx + 1}
              </span>
              <div>
                <div
                  className={`text-5xl font-extrabold tracking-tight ${
                    active ? 'text-ink-100' : done ? 'text-ink-200' : 'text-ink-400'
                  }`}
                >
                  {q}
                </div>
                {done && answer && (
                  <div className="mt-2 text-2xl text-accent/80">
                    &ldquo;{answer}
                    {answers[idx].length > 60 ? '\u2026' : ''}&rdquo;
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Generating() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-16">
      <div className="text-6xl font-black tracking-tight text-ink-100">
        Cooking up your roast
      </div>
      <div className="relative mt-12 h-3 w-96 overflow-hidden rounded-full bg-ink-700">
        <div
          className="absolute inset-y-0 left-0 w-1/4 rounded-full bg-accent"
          style={{ animation: 'thinkingSweep 1.4s ease-in-out infinite' }}
        />
      </div>
    </div>
  );
}

function Roasting({ state }: { state: SessionState }) {
  const text = state.roast?.text ?? '';
  const schedule = useMemo(() => computeRevealSchedule(text), [text]);
  const now = useNow(100);
  const elapsed = state.phaseStartedAt ? now - state.phaseStartedAt : 0;

  const revealedCount = Math.max(1, schedule.filter((s) => elapsed >= s.startMs).length);
  const visible = schedule.slice(0, revealedCount);

  return (
    <div className="flex h-full flex-col justify-center px-16 py-14">
      <Brand className="mb-10 text-xl" />
      <div className="space-y-4">
        {visible.map((seg, idx) => {
          const isCurrent = idx === visible.length - 1;
          return (
            <p
              key={idx}
              className={
                isCurrent
                  ? 'text-6xl font-black leading-tight tracking-tight text-ink-100'
                  : 'text-4xl font-semibold leading-snug text-ink-400'
              }
            >
              {seg.text}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function RoastCard({ state }: { state: SessionState }) {
  const sentences = splitSentences(state.roast?.text ?? '');
  const punchline = sentences.length
    ? sentences[sentences.length - 1]
    : 'That\u2019s a wrap.';

  return (
    <div className="flex h-full flex-col justify-between px-16 py-14">
      <Brand className="text-2xl" />
      <div className="flex flex-1 items-center">
        <blockquote className="max-w-6xl text-7xl font-black leading-[1.05] tracking-tight text-balance">
          <span className="text-accent">&ldquo;</span>
          {punchline}
          <span className="text-accent">&rdquo;</span>
        </blockquote>
      </div>
      <div className="text-3xl text-ink-200">
        Roasted at <span className="font-bold text-ink-100">.local</span> &mdash; your
        recording is on its way.
      </div>
    </div>
  );
}
