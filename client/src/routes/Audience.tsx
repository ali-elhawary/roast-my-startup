import { useEffect, useState } from 'react';
import { useSession } from '@/lib/ws';
import { Brand } from '@/lib/Brand';
import { splitSentences } from '@/lib/reveal';
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
    case 'generating':
    case 'roasting':
      content = <ConversationView state={state} />;
      break;
    case 'complete':
      content = <RoastCard state={state} />;
      break;
    case 'idle':
    default:
      content = <Attract />;
  }

  // Brand background image + dark scrim behind every audience state.
  return (
    <div className="relative h-full overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 bg-ink-900 bg-cover bg-center"
        style={{ backgroundImage: 'url(/audience-bg.jpg)', transform: 'scale(1.12)' }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-900/75 via-ink-900/55 to-ink-900/85" />
      <div className="relative h-full">
        {content}
        <NextUp state={state} />
      </div>
    </div>
  );
}

// Live turn-by-turn transcript with the current question, shown through the whole
// conversation (q1..q3, generating, roasting). The roast itself arrives as the
// roaster's turns in the feed, so it reads live instead of a separate reveal.
function ConversationView({ state }: { state: SessionState }) {
  const activeIndex =
    state.phase === 'q1' ? 0 : state.phase === 'q2' ? 1 : state.phase === 'q3' ? 2 : -1;
  const currentQuestion = activeIndex >= 0 ? QUESTIONS[activeIndex as 0 | 1 | 2] : null;
  const recent = state.transcript.slice(-4);
  const firstName = state.founder?.name.trim().split(/\s+/)[0];

  return (
    <div className="flex h-full flex-col px-16 py-12">
      <Brand className="text-4xl" />

      <div className="mt-8 min-h-[6rem]">
        {currentQuestion ? (
          <div className="flex items-center gap-6">
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-accent text-4xl font-bold text-ink-900">
              {activeIndex + 1}
            </span>
            <h1 className="text-7xl font-black leading-none tracking-tight text-ink-100">
              {currentQuestion}
            </h1>
          </div>
        ) : state.phase === 'generating' ? (
          <div className="inline-flex items-center gap-4 rounded-full bg-ink-800/80 px-8 py-4 text-4xl font-bold text-accent">
            Cooking up the roast
            <Dots />
          </div>
        ) : state.phase === 'roasting' ? (
          <div className="text-5xl font-black uppercase tracking-[0.2em] text-accent">The Roast</div>
        ) : (
          <h1 className="text-6xl font-black tracking-tight text-ink-100">
            You&rsquo;re up{firstName ? `, ${firstName}` : ''}.
          </h1>
        )}
      </div>

      {/* Live feed: last few turns, newest largest, older dimmed. */}
      <div className="mt-10 flex flex-1 flex-col justify-end gap-7 overflow-hidden">
        {recent.length === 0 ? (
          <p className="text-4xl text-ink-400">Listening&hellip;</p>
        ) : (
          recent.map((t, idx) => {
            const isNewest = idx === recent.length - 1;
            const isFounder = t.role === 'user';
            return (
              <div
                key={`${t.at}-${idx}`}
                className={isNewest ? 'opacity-100' : 'opacity-40'}
              >
                <div
                  className={`mb-1 text-2xl font-bold uppercase tracking-[0.15em] ${
                    isFounder ? 'text-ink-400' : 'text-accent'
                  }`}
                >
                  {isFounder ? 'Founder' : 'Roaster'}
                </div>
                <p
                  className={`${
                    isNewest ? 'text-6xl text-ink-100' : 'text-4xl text-ink-300'
                  } font-normal leading-tight tracking-tight`}
                >
                  {t.text}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-1.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-3 w-3 rounded-full bg-accent"
          style={{ animation: 'dotBlink 1.2s ease-in-out infinite', animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}

function NextUp({ state }: { state: SessionState }) {
  if (state.queue.length === 0) return null;
  const firstName = state.queue[0].name.trim().split(/\s+/)[0];
  return (
    <div className="fixed bottom-4 right-4 z-10 rounded-full bg-ink-800/85 px-6 py-3 text-3xl">
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
      <Brand className="text-5xl" />
      <div>
        <h1 className="max-w-6xl text-8xl font-black leading-[1.05] tracking-tight text-balance">
          Tell us what you&rsquo;re building.
          <br />
          Get <span className="text-accent">roasted</span> in two minutes.
        </h1>
        <div className="mt-12 h-20">
          <p
            key={i}
            className="text-5xl text-ink-200"
            style={{ animation: 'fadeInOut 4s ease-in-out' }}
          >
            {ATTRACT_LINES[i]}
          </p>
        </div>
      </div>
      <div className="text-3xl text-white">
        Sign in at the tablet &rarr; take the chair &rarr; brace yourself.
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
      <Brand className="text-5xl" />
      <div className="flex flex-1 items-center">
        <blockquote className="max-w-6xl font-serif text-8xl leading-[1.08] tracking-tight text-balance">
          <span className="text-accent">&ldquo;</span>
          {punchline}
          <span className="text-accent">&rdquo;</span>
        </blockquote>
      </div>
      <div className="text-4xl text-ink-200">
        Roasted at <span className="font-bold text-ink-100">.local</span> &mdash; your
        recording is on its way.
      </div>
    </div>
  );
}
