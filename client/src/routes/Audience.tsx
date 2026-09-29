import { useEffect, useState } from 'react';
import { useSession } from '@/lib/ws';
import { FitText } from '@/lib/FitText';
import type { SessionState } from '@shared/types';

// The most important screen. Read from 6-10 feet. It stays on the landing page
// (rotating sassy quips) for the whole session and only reveals the actual roast
// the moment the roaster delivers it (roasting -> complete). No live transcript.
export default function Audience() {
  const { state } = useSession();
  if (!state) return <Center>Connecting&hellip;</Center>;

  const showRoast =
    (state.phase === 'roasting' || state.phase === 'complete') && !!state.roast?.text;
  const content = showRoast ? <RoastCard state={state} /> : <Attract />;

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

// Sassy one-liners that rotate on the landing page. Generic crowd hype, not the
// founder's actual roast.
const QUIPS = [
  '"A moat made entirely of vibes."',
  '"You said AI eleven times and product zero."',
  '"Your TAM is everyone, which means it\u2019s no one."',
  '"Bold of you to charge for a feature Gmail ships free."',
  '"The deck says pre-revenue. The roast says pre-idea."',
  '"Great logo. Now what does it do?"',
  '"Disrupting an industry that politely asked you not to."',
  '"Your competitor is a spreadsheet, and it\u2019s winning."',
  '"Series A dreams on a hackathon budget."',
  '"Solving a problem three people have, beautifully."',
  '"Monetization strategy: hope, at scale."',
  'You\u2019re not in "stealth mode," you just have a domain name, a Canva logo, and zero customers. But hey, at least the custom Patagonia vests look official.',
  'Your pitch deck spent 20 slides explaining how AI will revolutionize your app, but your core business model is still just hoping your parents don\u2019t ask for their money back.',
  'Calling your company "Uber for X" isn\u2019t a strategy, it\u2019s just a venture-backed speedrun to bankruptcy. At least you got a ping pong table out of the deal.',
  '"We\u2019re pre-revenue" is an exceptionally polite way to say you\u2019ve been running a $2 million hobby for eighteen months. But sure, tell me more about your Series A projections.',
  'You spent three weeks debating your brand\u2019s official hex codes before ever speaking to a single human customer. Great news: the color palette looks fantastic on your zero active users.',
  'You\u2019re not "disrupting an industry," you\u2019re just burning venture capital to re-invent the public bus and charge five times as much for it.',
  'Saying your startup\u2019s culture is "work hard, play hard" just means you pay 80-hour workweeks with unlimited cold brew and equity that\u2019s currently worth a gift card to Subway.',
  'You called an all-hands meeting to finalize the company\u2019s core values, yet nobody in the room actually knows what the software is supposed to do.',
  'Your burn rate is higher than a rocket launch, but you\u2019re still convinced a single viral TikTok will somehow make the unit economics work.',
  'The founder talks about "changing the world" like they\u2019re landing a man on the moon, but the product is literally just an app that tells you when your laundry is dry.',
];

// Cycle an index every `ms`.
function useRotating(count: number, ms: number): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % count), ms);
    return () => clearInterval(id);
  }, [count, ms]);
  return i;
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

function Attract() {
  const i = useRotating(QUIPS.length, 6000);
  return (
    <div className="flex h-full flex-col px-16 py-14">
      <h1 className="max-w-6xl text-8xl font-black leading-[1.05] tracking-tight text-balance">
        Tell us what you&rsquo;re building.
        <br />
        Get <span className="text-accent">roasted</span> in two minutes.
      </h1>
      <div className="flex-1 py-10">
        <FitText
          maxPx={64}
          minPx={24}
          refitKey={i}
          className="max-w-6xl leading-tight tracking-tight text-balance text-ink-200"
        >
          {QUIPS[i]}
        </FitText>
      </div>
      <div className="text-3xl text-white">
        Sign in at the laptop &rarr; take the chair &rarr; brace yourself.
      </div>
    </div>
  );
}

function RoastCard({ state }: { state: SessionState }) {
  const roast = state.roast?.text?.trim() || 'That\u2019s a wrap.';
  return (
    <div className="flex h-full flex-col justify-between px-16 py-14">
      <div className="flex flex-1 items-center">
        <FitText
          maxPx={88}
          minPx={30}
          refitKey={roast}
          className="max-w-6xl font-serif leading-[1.12] tracking-tight text-balance text-ink-100"
        >
          <span className="text-accent">&ldquo;</span>
          {roast}
          <span className="text-accent">&rdquo;</span>
        </FitText>
      </div>
      <div className="text-4xl text-ink-200">
        Roasted at <span className="font-bold text-ink-100">.local</span> &mdash; you could be
        next. Sign in at the laptop.
      </div>
    </div>
  );
}
