// Shared, editable configuration. Mirror the category list and banned words in
// the ElevenLabs agent prompt (see AGENT_PROMPT.md).

// The three questions the host asks, in order. Editable defaults seeded from
// the event brief. The agent speaks these; the screens display them.
export const QUESTIONS = [
  'What are you building?',
  'Who is it for?',
  'Why does it win?',
] as const;

// Fixed category tag list. The agent returns exactly one of these with each
// roast; the live /panel screen aggregates over them.
export const CATEGORIES = [
  'ai-agents',
  'devtools',
  'infrastructure',
  'fintech',
  'healthtech',
  'marketplace',
  'consumer',
  'climate',
  'security',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

// Human-readable labels for the /panel screen.
export const CATEGORY_LABELS: Record<Category, string> = {
  'ai-agents': 'AI Agents',
  devtools: 'Dev Tools',
  infrastructure: 'Infrastructure',
  fintech: 'Fintech',
  healthtech: 'Healthtech',
  marketplace: 'Marketplace',
  consumer: 'Consumer',
  climate: 'Climate',
  security: 'Security',
  other: 'Other',
};

// Roast length bounds, in words. The persona targets ~90-120 words; the hard
// cap is higher so a slightly long-winded (but fine) roast isn't rejected and
// forced into a costly regenerate. A reject should be rare.
export const ROAST_MIN_WORDS = 60;
export const ROAST_MAX_WORDS = 160;

// Denylist enforced in code before any roast reaches the speaker. Keep this in
// one place and mirror it in the agent system prompt.
export const BANNED_WORDS = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'cunt',
  'dick',
  'retard',
];

// Timings (ms).
// READY: if the founder who's up never taps Begin, advance to the next in line.
// COMPLETE_SAFETY: the roast card stays until someone taps Done; this long
// backstop only advances if the booth is abandoned. Neither applies during
// q1..q3, generating, or roasting.
export const READY_IDLE_TIMEOUT_MS = 90_000;
export const COMPLETE_SAFETY_TIMEOUT_MS = 150_000; // ~2.5 min backstop
export const QUESTION_TIMEOUT_MS = 55_000; // per-question safety net (founder answer time)
export const GENERATION_TIMEOUT_MS = 20_000; // hung-generation recovery
export const GENERATING_WARN_MS = 6_000; // operator warning threshold

// Estimated speaking rate for the /audience roast reveal.
export const WORDS_PER_MINUTE = 150;

// Manual nudge (ms) for aligning the muxed conversation audio + captions to the
// video. Added to the measured connect offset. Positive pushes audio/captions
// later. Tune by ear after a live run; 0 is a good starting point.
export const SYNC_CALIBRATION_MS = 0;

// How long the cloud delivery pipeline waits for the video to land before
// falling back to emailing the audio recording. Only used when VIDEO_ENABLED is
// set: the audio email fires this long after `complete` unless the video
// delivered first. With 720p capture the transcode+upload finishes in seconds,
// so 3 minutes lets a healthy video always win while still reaching the founder
// quickly if the video pipeline genuinely fails.
export const DELIVERY_FALLBACK_MS = 180_000;
