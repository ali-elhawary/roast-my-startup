import { useEffect, useState } from 'react';
import { useSession } from '@/lib/ws';
import { FitText } from '@/lib/FitText';
import type { SessionState } from '@shared/types';

// The most important screen. Read from 6-10 feet. It stays on the landing page
// (headline + rotating sassy quips) the entire time — the roast is never shown
// here; it only goes to the founder's video/email.
export default function Audience() {
  const { state } = useSession();
  if (!state) return <Center>Connecting&hellip;</Center>;

  const content = <Attract />;

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
  '"Not stealth mode \u2014 just a domain, a Canva logo, and zero customers."',
  '"Twenty AI slides, and the model is \u2018don\u2019t tell my parents.\u2019"',
  '"\u2018Uber for X\u2019 isn\u2019t a strategy, it\u2019s a speedrun to bankruptcy."',
  '"\u2018Pre-revenue\u2019 is a polite word for an expensive hobby."',
  '"Three weeks on hex codes, zero minutes on customers."',
  '"Not disrupting anything \u2014 just a pricier public bus."',
  '"\u2018Work hard, play hard\u2019 \u2014 80-hour weeks, worthless equity."',
  '"Core values finalized before anyone knew what it does."',
  '"Rocket-tier burn rate, one viral TikTok from ruin."',
  '"\u2018Changing the world\u2019 with an app that says your laundry\u2019s dry."',
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


