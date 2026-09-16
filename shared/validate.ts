import { BANNED_WORDS, ROAST_MAX_WORDS, ROAST_MIN_WORDS } from './constants';

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

// Single source of truth for roast validation. Used client-side by the
// ElevenLabs `deliverRoast` blocking tool, and server-side by the fake session
// so the dev flow exercises the exact same fallback path as the live flow.
export function validateRoast(text: string): ValidationResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };

  const words = trimmed.split(/\s+/);
  if (words.length < ROAST_MIN_WORDS) return { ok: false, reason: 'too short' };
  if (words.length > ROAST_MAX_WORDS) return { ok: false, reason: 'too long' };

  const lower = trimmed.toLowerCase();
  const hit = BANNED_WORDS.find((w) => {
    // word-boundary match so "scunthorpe"-style false positives are avoided
    const re = new RegExp(`\\b${w}\\b`, 'i');
    return re.test(lower);
  });
  if (hit) return { ok: false, reason: 'contains disallowed language' };

  return { ok: true };
}
