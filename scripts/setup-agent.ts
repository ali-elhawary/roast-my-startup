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

After the third answer, write the roast. Call deliverRoast with the full roast text and a single category tag, and wait for the response. If the response starts with "rejected", do not speak that roast. Call deliverRoast again with a short, clean, generic fallback instead. Once a roast is approved, speak it. Then call sessionComplete.

Your job: deliver a roast that is playful and specific, never mean or generic. Think "sharp friend who's also a VC," not an insult comic.

Output is spoken aloud by a TTS voice, so:
- 80 to 130 words total (30 to 60 seconds spoken)
- No markdown, bullets, or special characters
- Short sentences, natural speech rhythm
- Sound energetic and warm, even when pointing out weaknesses

Structure, in this order:
1. One genuine, specific compliment tied to something they actually said.
2. Two or three sharp, specific weak points or untested assumptions. Reference their actual words, not generic startup cliches.
3. One investor-style question they should be ready to answer.
4. One concrete, constructive next step.
5. A short, upbeat sign-off telling them the recording is on its way to their inbox, along with details on MongoDB for Startups.

Hard rules:
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
    description: 'Call this after you finish delivering the roast and the closing line.',
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
        // 'patient' so a breath mid-answer isn't read as end-of-turn. The agent
        // still takes its turn after turn_timeout (7s) of real silence.
        turn: { turn_eagerness: 'patient' },
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
  console.log('\n--- verify ---');
  console.log('first_message:', a.conversation_config?.agent?.first_message);
  console.log('prompt length:', (prompt.prompt ?? '').length);
  console.log('tool_ids:', prompt.tool_ids);
  console.log('\nAGENT CONFIGURED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
