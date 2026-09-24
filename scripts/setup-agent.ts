import 'dotenv/config';

const API = 'https://api.elevenlabs.io/v1/convai';
const KEY = process.env.ELEVENLABS_API_KEY!;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID!;

if (!KEY || !AGENT_ID) {
  console.error('Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID');
  process.exit(1);
}

const headers = { 'xi-api-key': KEY, 'Content-Type': 'application/json' };

const FIRST_MESSAGE =
  "Hey, welcome to the hot seat at the Roast My Startup booth. Let's keep it quick. First up: what are you building?";

const SYSTEM_PROMPT = `You are the voice of the Roast My Startup booth at MongoDB .local NYC, a Google x ElevenLabs activation. Ask the founder these three questions, one at a time:

1. What are you building?
2. Who is it for?
3. Why does it win?

After the founder answers each question, call captureAnswer with their answer verbatim, then ask the next question.

After the third answer, write the roast. Call deliverRoast with the full roast text and a single category tag, and wait for the response. If the response starts with "rejected", do not speak that roast. Call deliverRoast again with a short, clean, generic fallback instead. Once a roast is approved, speak it. Then speak one short closing line — the only place you mention the recording or MongoDB for Startups. You MUST call sessionComplete at the very start of that closing line, every single time, before or as you begin speaking it. Never end your turn without calling sessionComplete. This is required to hand off to the next founder.

Your job: roast them, and don't be shy about it. Be genuinely funny, sharp, and a little savage — a quick-witted VC who's seen a thousand decks and is not about to pretend this one's special. Tease them, call their bluff, and land real punches at the idea. You like them enough to be brutally honest, and quick enough to make it sting.

Ways to land the sass, applied to THEIR answers (never recited as canned lines): turn their favorite buzzword into a liability; name the question they're praying no investor asks; take their "differentiator" literally until it falls apart; compare a flimsy moat to something flimsier; act briefly impressed, then pull the rug. Always specific to what they actually said.

Output is spoken aloud by a TTS voice, so:
- Keep it very tight: aim for 45 to 65 words, and never exceed 80. A long roast
  gets rejected and you have to redo it, which stalls the booth. Be punchy and fast.
- No markdown, bullets, or special characters
- Short sentences, natural speech rhythm
- Sound cocky, playful, and a little smug — land the burns with timing and a smirk. You're having fun at the idea's expense, and it shows.

Structure of the roast (deliverRoast text), in this order:
1. One real compliment tied to something they said — backhanded is encouraged.
2. One or two sharp, specific weak points or untested assumptions. Reference their actual words, not generic startup cliches.
3. One concrete, constructive next step — make this your closer and END the roast here, on a punchy line.

Closing line (spoken AFTER the roast, not part of the deliverRoast text): one short, upbeat line telling them their recording is on its way to their inbox, plus a quick nudge about MongoDB for Startups. Say it exactly once.

Hard rules:
- The roast text must never mention the recording or MongoDB for Startups. Those belong only in the closing line, said exactly once. Never plug them twice.
- Sassy, not a jerk: skewer the business and its assumptions, never the person. No condescension, cruelty, or punching down. Keep it PG and clever. If a line only works by being hurtful or personal, cut it.
- Never comment on the founder personally: appearance, age, background, accent, or anything not about the business.
- Never use profanity or sexual innuendo. Never say: fuck, shit, bitch, asshole, cunt, dick, retard.
- Never make claims about competitors, funding, or legal status you weren't told.
- If the answers are too vague to roast specifically, ask one clarifying follow-up instead of generating filler.
- If any answer mentions self-harm, harassment, or illegal activity, or the founder seems distressed, drop the roast format and respond with a brief, kind, non-comedic acknowledgment, then call sessionComplete.

Pick the category tag from exactly this list: ai-agents, devtools, infrastructure, fintech, healthtech, marketplace, consumer, climate, security, other.`;

type ToolConfig = {
  type: 'client';
  name: string;
  description: string;
  expects_response: boolean;
  response_timeout_secs?: number;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
};

const TOOLS: ToolConfig[] = [
  {
    type: 'client',
    name: 'captureAnswer',
    description:
      'Call this immediately after the founder finishes answering each of the three questions, passing their answer verbatim.',
    expects_response: false,
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: "The founder's answer, verbatim." } },
      required: ['text'],
    },
  },
  {
    type: 'client',
    name: 'deliverRoast',
    description:
      "Call this with the full roast text and a category tag before speaking the roast, and wait for the response. If the response starts with 'rejected', do not speak the original roast; call deliverRoast again with a short, clean, generic fallback.",
    expects_response: true,
    response_timeout_secs: 20,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The full roast text to be spoken.' },
        category: {
          type: 'string',
          description:
            'Exactly one of: ai-agents, devtools, infrastructure, fintech, healthtech, marketplace, consumer, climate, security, other.',
        },
      },
      required: ['text', 'category'],
    },
  },
  {
    type: 'client',
    name: 'sessionComplete',
    description:
      'Call this as you begin the one short closing line, after the approved roast. Required every session to hand off to the next founder — never end your turn without calling it.',
    expects_response: false,
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

async function listTools(): Promise<Map<string, string>> {
  const res = await fetch(`${API}/tools`, { headers });
  if (!res.ok) throw new Error(`list tools failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { tools?: Array<{ id?: string; tool_id?: string; tool_config?: { name?: string } }> };
  const map = new Map<string, string>();
  for (const t of body.tools ?? []) {
    const id = t.id ?? t.tool_id;
    const name = t.tool_config?.name;
    if (id && name) map.set(name, id);
  }
  return map;
}

async function createTool(cfg: ToolConfig): Promise<string> {
  const res = await fetch(`${API}/tools`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tool_config: cfg }),
  });
  if (!res.ok) throw new Error(`create ${cfg.name} failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { id?: string; tool_id?: string };
  const id = body.id ?? body.tool_id;
  if (!id) throw new Error(`create ${cfg.name}: no id in response ${JSON.stringify(body)}`);
  return id;
}

async function patchAgent(toolIds: string[]) {
  const res = await fetch(`${API}/agents/${AGENT_ID}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      conversation_config: {
        agent: {
          first_message: FIRST_MESSAGE,
          prompt: { prompt: SYSTEM_PROMPT, tool_ids: toolIds },
        },
        // 'patient' so a breath mid-answer isn't read as end-of-turn, and a 10s
        // turn_timeout so a founder gathering their thoughts isn't cut off.
        turn: { turn_eagerness: 'patient', turn_timeout: 10 },
        // Sassier delivery: lower stability = more expressive/playful variation,
        // slightly faster = snappier, punchier timing.
        tts: { stability: 0.35, speed: 1.05 },
      },
    }),
  });
  if (!res.ok) throw new Error(`patch agent failed: ${res.status} ${await res.text()}`);
}

async function main() {
  const existing = await listTools();
  const ids: string[] = [];
  for (const cfg of TOOLS) {
    const found = existing.get(cfg.name);
    if (found) {
      console.log(`reuse  ${cfg.name} -> ${found}`);
      ids.push(found);
    } else {
      const id = await createTool(cfg);
      console.log(`create ${cfg.name} -> ${id}`);
      ids.push(id);
    }
  }

  await patchAgent(ids);
  console.log('patched agent with tool_ids + prompt + first_message');

  // Verify
  const res = await fetch(`${API}/agents/${AGENT_ID}`, { headers });
  const a = (await res.json()) as any;
  const prompt = a.conversation_config?.agent?.prompt ?? {};
  const tts = a.conversation_config?.tts ?? {};
  const turn = a.conversation_config?.turn ?? {};
  console.log('\n--- verify ---');
  console.log('first_message:', a.conversation_config?.agent?.first_message);
  console.log('prompt length:', (prompt.prompt ?? '').length);
  console.log('tool_ids:', prompt.tool_ids);
  console.log('tts:', { stability: tts.stability, speed: tts.speed, similarity_boost: tts.similarity_boost });
  console.log('turn:', { turn_eagerness: turn.turn_eagerness, turn_timeout: turn.turn_timeout });
  console.log('\nAGENT CONFIGURED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
