import { useState } from 'react';
import { useSession } from '@/lib/ws';
import { Brand } from '@/lib/Brand';

// Placeholder T&C body — replace with the real MongoDB-approved copy.
const TERMS_LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. This session is recorded. ' +
  'The recording will be emailed to you and MongoDB may follow up about the Startups ' +
  'program. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ' +
  'ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea ' +
  'commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse.';

export default function Signin() {
  const { state, connected, sendCommand } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const busy = !!state && state.phase !== 'idle';
  const canSubmit = name.trim() !== '' && email.trim() !== '' && agreed;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    sendCommand({ type: 'signin', name: name.trim(), email: email.trim() });
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <Brand className="mb-10 text-lg" />
        <div className="text-5xl font-extrabold text-accent">You're in, {name.trim()}.</div>
        <p className="mt-6 max-w-xl text-2xl text-ink-200">
          {busy
            ? 'A session is in progress. Take a seat when you\u2019re called.'
            : 'Take a seat when you\u2019re called.'}
        </p>
        <button
          className="mt-12 text-base text-ink-400 underline underline-offset-4"
          onClick={() => {
            setSubmitted(false);
            setName('');
            setEmail('');
            setAgreed(false);
          }}
        >
          Sign in another founder
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center px-8">
      <Brand className="mb-8 text-lg" />
      <h1 className="text-4xl font-extrabold tracking-tight">Roast My Startup</h1>
      <p className="mt-2 text-xl text-ink-200">
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
            placeholder="Ada Lovelace"
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
            placeholder="ada@startup.com"
            autoComplete="off"
          />
        </div>

        <div className="max-h-32 overflow-y-auto rounded-lg border border-ink-600 bg-ink-800/60 p-3 text-sm text-ink-200">
          {TERMS_LOREM}
        </div>

        <label className="flex items-start gap-3 text-base">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 h-5 w-5 accent-[#39FF6A]"
          />
          <span className="text-ink-100">
            I agree to the terms and consent to being recorded and contacted.
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
    </div>
  );
}
