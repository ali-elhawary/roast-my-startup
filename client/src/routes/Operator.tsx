import { useSession } from '@/lib/ws';
import { useNow } from '@/lib/useNow';
import { GENERATING_WARN_MS } from '@shared/constants';
import type { Command, Phase } from '@shared/types';

const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Idle',
  ready: 'Ready',
  q1: 'Question 1',
  q2: 'Question 2',
  q3: 'Question 3',
  generating: 'Generating',
  roasting: 'Roasting',
  complete: 'Complete',
};

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export default function Operator() {
  const { state, connected, sendCommand } = useSession();
  const now = useNow(200);

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center text-2xl text-ink-400">
        Connecting to server&hellip;
      </div>
    );
  }

  const phaseElapsed = state.phaseStartedAt ? now - state.phaseStartedAt : 0;
  const totalElapsed = state.founder ? now - state.founder.consentAt : 0;
  const generatingWarn = state.phase === 'generating' && phaseElapsed > GENERATING_WARN_MS;

  const send = (c: Command) => sendCommand(c);
  const runFake = async (variant: 'pass' | 'banned') => {
    await fetch('/api/dev/fake-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant }),
    });
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-6 font-mono text-ink-100">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-lg font-bold">Operator</div>
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`h-3 w-3 rounded-full ${connected ? 'bg-accent' : 'bg-red-500'}`}
          />
          {connected ? 'WS connected' : 'WS disconnected'}
        </div>
      </div>

      {/* Phase + timers */}
      <div className="rounded-lg border border-ink-600 bg-ink-800 p-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-400">Phase</div>
            <div className="text-4xl font-black text-accent">
              {PHASE_LABELS[state.phase]}
            </div>
          </div>
          <div className="text-right text-sm text-ink-200">
            <div>
              phase <span className="tabular-nums text-ink-100">{fmt(phaseElapsed)}</span>
              {state.paused && <span className="ml-2 text-yellow-400">PAUSED</span>}
            </div>
            <div>
              total <span className="tabular-nums text-ink-100">{fmt(totalElapsed)}</span>
            </div>
            <div className="text-ink-400">source: {state.sessionSource ?? '\u2014'}</div>
          </div>
        </div>
      </div>

      {/* Warnings + error */}
      {generatingWarn && (
        <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-300">
          Generating has exceeded {GENERATING_WARN_MS / 1000}s &mdash; consider skip roast.
        </div>
      )}
      {state.error && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          <span>Error: {state.error}</span>
          <button className="underline" onClick={() => send({ type: 'reset' })}>
            clear
          </button>
        </div>
      )}

      {/* Founder + answers */}
      <div className="grid grid-cols-2 gap-4">
        <Info label="Founder" value={state.founder?.name ?? '\u2014'} />
        <Info label="Email" value={state.founder?.email ?? '\u2014'} />
        <Info
          label="Roast source"
          value={state.roast ? state.roast.source : '\u2014'}
        />
        <Info label="Video" value={state.videoStatus ?? '\u2014'} />
      </div>

      {/* Waiting line */}
      <div className="rounded-lg border border-ink-600 bg-ink-800 p-4 text-sm">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-ink-400">
            Waiting line ({state.queue.length})
          </span>
          <button
            className="rounded bg-ink-600 px-3 py-1 text-xs font-bold text-ink-100 hover:bg-ink-400 disabled:bg-ink-700 disabled:text-ink-400"
            onClick={() => send({ type: 'next' })}
            disabled={state.queue.length === 0}
          >
            Call next &rarr;
          </button>
        </div>
        {state.queue.length === 0 ? (
          <div className="text-ink-400">Nobody waiting.</div>
        ) : (
          <ol className="space-y-1">
            {state.queue.map((f, i) => (
              <li key={f.id} className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-ink-400">{i + 1}.</span>
                <span className="flex-1 truncate text-ink-100">{f.name}</span>
                <span className="truncate text-ink-400">{f.email}</span>
                <button
                  className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10"
                  onClick={() => send({ type: 'dequeue', id: f.id })}
                >
                  remove
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="rounded-lg border border-ink-600 bg-ink-800 p-4 text-sm">
        <div className="mb-2 text-xs uppercase tracking-wide text-ink-400">Answers</div>
        <AnswerRow n={1} label="Building" text={state.answers.building} />
        <AnswerRow n={2} label="Audience" text={state.answers.audience} />
        <AnswerRow n={3} label="Differentiation" text={state.answers.differentiation} />
      </div>

      {/* Controls */}
      <div className="grid grid-cols-3 gap-3">
        <Btn onClick={() => send({ type: 'start' })} disabled={state.phase !== 'ready'}>
          Start
        </Btn>
        {state.paused ? (
          <Btn onClick={() => send({ type: 'resume' })}>Resume</Btn>
        ) : (
          <Btn onClick={() => send({ type: 'pause' })}>Pause</Btn>
        )}
        <Btn
          onClick={() => send({ type: 'advance' })}
          disabled={!['q1', 'q2', 'q3'].includes(state.phase)}
        >
          Advance screen
        </Btn>
        <Btn
          onClick={() => send({ type: 'skip' })}
          disabled={!['q1', 'q2', 'q3'].includes(state.phase)}
        >
          Skip question
        </Btn>
        <Btn
          onClick={() => send({ type: 'skipRoast' })}
          disabled={['idle', 'complete'].includes(state.phase)}
        >
          Skip roast &rarr; rep
        </Btn>
        <Btn
          onClick={() => send({ type: 'restart' })}
          disabled={['idle', 'complete'].includes(state.phase)}
        >
          Restart roast
        </Btn>
        <Btn onClick={() => send({ type: 'reset' })}>Reset</Btn>
        <Btn onClick={() => send({ type: 'stop' })} danger>
          Emergency stop
        </Btn>
      </div>

      {/* Dev-only fake session */}
      <div className="mt-auto rounded-lg border border-dashed border-ink-600 bg-ink-800/50 p-4">
        <div className="mb-2 text-xs uppercase tracking-wide text-ink-400">
          Dev &mdash; run fake session (no mic needed)
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Btn onClick={() => runFake('pass')}>Fake: passing roast</Btn>
          <Btn onClick={() => runFake('banned')}>Fake: banned &rarr; fallback</Btn>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-800 p-3">
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
      <div className="truncate text-lg text-ink-100">{value}</div>
    </div>
  );
}

function AnswerRow({ n, label, text }: { n: number; label: string; text: string }) {
  return (
    <div className="flex gap-3 py-1">
      <span className="w-6 shrink-0 text-ink-400">{n}.</span>
      <span className="w-32 shrink-0 text-ink-400">{label}</span>
      <span className="flex-1 text-ink-100">{text || '\u2014'}</span>
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400 ${
        danger
          ? 'bg-red-600 text-white hover:bg-red-500'
          : 'bg-ink-600 text-ink-100 hover:bg-ink-400'
      }`}
    >
      {children}
    </button>
  );
}
