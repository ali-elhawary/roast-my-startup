import { WORDS_PER_MINUTE } from '@shared/constants';

export type RevealSegment = { text: string; startMs: number; endMs: number };

// The ONE place roast reveal timing lives. Right now it estimates per-sentence
// duration from word count at WORDS_PER_MINUTE. Swap the body for real
// character-level timing from the agent's onAudioAlignment later without
// touching the /audience screen.
export function computeRevealSchedule(text: string): RevealSegment[] {
  const sentences = splitSentences(text);
  const msPerWord = 60_000 / WORDS_PER_MINUTE;

  const segments: RevealSegment[] = [];
  let cursor = 0;
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean).length;
    const duration = Math.max(700, words * msPerWord);
    segments.push({ text: sentence, startMs: cursor, endMs: cursor + duration });
    cursor += duration;
  }
  return segments;
}

export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const matches = trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [trimmed];
}
