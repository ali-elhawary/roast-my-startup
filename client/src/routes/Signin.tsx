import { useState } from 'react';
import { useSession } from '@/lib/ws';
import { Brand } from '@/lib/Brand';
import type { SessionState } from '@shared/types';

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

// Live waiting-line panel shown alongside the sign-up form.
function LinePanel({ state }: { state: SessionState | null }) {
  if (!state) return null;
  const nowRoasting = state.phase !== 'idle' && state.founder ? state.founder : null;
  return (
    <div className="fixed right-4 top-4 w-64 rounded-xl border border-ink-600 bg-ink-800/85 p-4">
      <div className="text-xs uppercase tracking-wide text-ink-400">
        Waiting line ({state.queue.length})
      </div>
      {nowRoasting && (
        <div className="mt-2 text-sm">
          <span className="text-ink-400">Now roasting: </span>
          <span className="font-bold text-accent">{firstNameOf(nowRoasting.name)}</span>
        </div>
      )}
      {state.queue.length === 0 ? (
        <div className="mt-3 text-sm text-ink-400">No one waiting yet.</div>
      ) : (
        <ol className="mt-3 space-y-1 text-sm">
          {state.queue.map((f, i) => (
            <li key={f.id} className="flex gap-2">
              <span className="w-4 shrink-0 text-ink-400">{i + 1}.</span>
              <span className="truncate text-ink-100">{firstNameOf(f.name)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Consent statement shown above the agree checkbox (event-approved copy).
const CONSENT_STATEMENT =
  'This session will be recorded (video and audio). The recording will be emailed ' +
  'to you after your session. By participating, you agree that MongoDB may contact ' +
  'you using the information provided about the MongoDB for Startups program and you ' +
  'consent to providing your contact information to third-party event sponsors.';

export default function Signin() {
  const { state, connected, sendCommand } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const busy = !!state && state.phase !== 'idle';
  const canSubmit =
    name.trim() !== '' && email.trim() !== '' && company.trim() !== '' && agreed;
  // Mirrors the server rule: an idle booth with an empty line auto-promotes this
  // sign-in straight to the chair. Captured at submit so the confirmation copy
  // matches what actually happened.
  const [wentStraightUp, setWentStraightUp] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setWentStraightUp(!!state && state.phase === 'idle' && state.queue.length === 0);
    sendCommand({
      type: 'signin',
      name: name.trim(),
      email: email.trim(),
      company: company.trim(),
    });
    setSubmitted(true);
  }

  if (submitted) {
    const myEmail = email.trim();
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <Brand className="mb-10 text-2xl" />
        <div className="text-6xl font-extrabold text-accent">You're in, {name.trim()}.</div>
        {wentStraightUp ? (
          <p className="mt-6 max-w-2xl text-3xl text-ink-200">
            You&rsquo;re up next &mdash; take the chair and tap{' '}
            <span className="text-ink-100">Begin</span> when you&rsquo;re ready.
          </p>
        ) : (
          <p className="mt-6 max-w-2xl text-3xl text-ink-200">
            You&rsquo;ve joined the line &mdash; we&rsquo;ll email{' '}
            <span className="text-ink-100">{myEmail}</span> when you&rsquo;re close to the front.
            Take a look around, we&rsquo;ll ping you.
          </p>
        )}
        <button
          className="mt-12 text-base text-ink-400 underline underline-offset-4"
          onClick={() => {
            setSubmitted(false);
            setWentStraightUp(false);
            setName('');
            setEmail('');
            setCompany('');
            setAgreed(false);
          }}
        >
          Sign in another founder
        </button>
        <LinePanel state={state} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center px-8">
      <Brand className="mb-8 text-2xl" />
      <h1 className="text-5xl font-extrabold tracking-tight">Roast My Startup</h1>
      <p className="mt-2 text-2xl text-ink-200">
        Three questions. One roast. Two minutes.
      </p>

      {busy && (
        <div className="mt-6 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-base text-accent">
          Session in progress &mdash; sign in shortly and we&rsquo;ll queue you next.
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-200">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-ink-600 bg-ink-800 px-4 py-3 text-lg outline-none focus:border-accent"
            placeholder="Jane Doe"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-200">Email</label>
          <input
            value={email}
            type="email"
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-ink-600 bg-ink-800 px-4 py-3 text-lg outline-none focus:border-accent"
            placeholder="jane@startup.com"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-200">Startup Name</label>
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="w-full rounded-lg border border-ink-600 bg-ink-800 px-4 py-3 text-lg outline-none focus:border-accent"
            placeholder="Acme Labs"
            autoComplete="off"
          />
        </div>

        <div className="max-h-40 overflow-y-auto rounded-lg border border-ink-600 bg-ink-800/60 p-3 text-sm text-ink-200">
          {CONSENT_STATEMENT}
        </div>

        <label className="flex items-start gap-3 text-base">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 h-5 w-5 accent-[#39FF6A]"
          />
          <span className="text-ink-100">
            I agree to the above and consent to being recorded, contacted, and providing
            my information to third-party event sponsors.
          </span>
        </label>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-lg bg-accent py-4 text-lg font-bold text-ink-900 transition disabled:cursor-not-allowed disabled:bg-ink-600 disabled:text-ink-400"
        >
          {busy ? 'Join the queue' : 'Sign in'}
        </button>
      </form>

      <div className="mt-6 text-xs text-ink-400">
        {connected ? 'Connected' : 'Reconnecting\u2026'}
      </div>
      <LinePanel state={state} />
    </div>
  );
}
