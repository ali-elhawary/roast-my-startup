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
// Idle auto-reset catches abandonment. `ready` needs enough time for a founder
// to get seated and the operator to press start; `complete` should let the
// roast card be photographed before it clears. Neither applies during q1..q3,
// generating, or roasting.
export const READY_IDLE_TIMEOUT_MS = 90_000;
export const COMPLETE_IDLE_TIMEOUT_MS = 45_000;
export const QUESTION_TIMEOUT_MS = 55_000; // per-question safety net (founder answer time)
export const GENERATING_WARN_MS = 6_000; // operator warning threshold

// Estimated speaking rate for the /audience roast reveal.
export const WORDS_PER_MINUTE = 150;
