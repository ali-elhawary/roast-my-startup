import { useSession } from '@/lib/ws';
import { Brand } from '@/lib/Brand';
import { CATEGORIES, CATEGORY_LABELS, type Category } from '@shared/constants';

// Dedicated outward-facing monitor: the running count of what founders are
// building today, grouped by the category tag the agent returns.
export default function Panel() {
  const { state } = useSession();
  const byCategory = state?.stats.byCategory ?? {};
  const total = state?.stats.sessionsToday ?? 0;

  const rows = CATEGORIES.map((c) => ({
    category: c as Category,
    label: CATEGORY_LABELS[c as Category],
    count: byCategory[c] ?? 0,
  }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="flex h-full flex-col px-12 py-10">
      <div className="flex items-center justify-between">
        <Brand className="text-xl" />
        <div className="text-xl text-ink-200">
          <span className="font-extrabold text-accent">{total}</span> roasted today
        </div>
      </div>

      <h1 className="mt-8 text-5xl font-extrabold tracking-tight text-balance">
        What founders are building at .local, so far today
      </h1>

      <div className="mt-10 flex-1">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-3xl text-ink-400">
            No sessions yet &mdash; be the first in the chair.
          </div>
        ) : (
          <ul className="space-y-5">
            {rows.map((r) => (
              <li key={r.category} className="flex items-center gap-6">
                <div className="w-56 shrink-0 text-3xl font-semibold text-ink-100">
                  {r.label}
                </div>
                <div className="h-10 flex-1 overflow-hidden rounded bg-ink-700">
                  <div
                    className="h-full rounded bg-accent transition-[width] duration-700"
                    style={{ width: `${(r.count / max) * 100}%` }}
                  />
                </div>
                <div className="w-16 shrink-0 text-right text-3xl font-extrabold tabular-nums text-accent">
                  {r.count}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
