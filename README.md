# Roast My Startup — booth app

Kiosk web app for the MongoDB .local NYC booth. A founder answers three
questions, an ElevenLabs voice agent roasts their startup, and four browser
screens on a local network follow one shared session in real time.

One repo, one Node server, one WebSocket. The server holds a single in-memory
session state and broadcasts the whole object to every screen on every change.
No database, no auth.

## Screens

Open each in its own browser window.

| Route | Device | What it shows |
|---|---|---|
| `/signin` | tablet at the entrance | name, email, consent; queues the next founder while the booth is busy |
| `/station` | screen in front of the founder | the current question, a 55s bar, thinking/listening states. Runs the live agent. |
| `/audience` | large outward monitor | attract loop, question list, roast revealed sentence by sentence, photo-ready roast card |
| `/panel` | second outward monitor | running count of what founders are building today, by category |
| `/operator` | host tablet | phase, timers, answers, controls, and the dev fake-session buttons |

## Run it

```bash
npm install
cp .env.example .env   # then paste your ElevenLabs key + agent id (already set locally)
npm run dev            # server on :3001, Vite on :5173
```

Open `http://localhost:5173/operator` and press **Fake: passing roast**. Every
screen moves through all phases with mock roast text appearing sentence by
sentence on `/audience`. No microphone or API key needed for the fake path.

Production build served on one port:

```bash
npm run build
npm start              # http://localhost:3001
```

## The two flows share one state machine

Every phase change goes through `reduce()` in `server/state.ts`. Nothing else
sets `phase`. Timeouts dispatch commands instead of mutating state. The live
agent and the fake session send the same commands; only the origin differs.

- **Live:** the founder signs in, the operator presses start, `/station` opens the
  ElevenLabs session, and the agent's client tools send `answer`, `roast`, and
  `complete`.
- **Fake:** the operator's button runs a server-side timer (`server/fakeSession.ts`)
  that dispatches those same commands on a schedule. Its `banned` variant ships a
  roast with a banned word so you can watch the fallback path.

`sessionSource` (`live` or `fake`) keeps them apart: `/station` only opens a real
agent session when the source is `live`.

## Booth topology and the microphone

`getUserMedia` needs a secure context. Run the `/station` browser on the same
machine as the server (`localhost`) so the mic works without TLS. The other three
screens can be remote over `http://<lan-ip>:3001` — the WebSocket URL is derived
from the page, so nothing is hard-coded. If `/station` must be a separate device,
serve over HTTPS (mkcert or a tunnel) first.

`/station` shows a one-time **Start kiosk** tap. That grants the mic and unlocks
audio autoplay for the session, then the agent auto-starts each time the operator
presses start.

## ElevenLabs setup

See `AGENT_PROMPT.md` for the three client tools, the agent settings, and the
system prompt. The API key stays server-side: the browser fetches a short-lived
signed URL from `/api/agent/signed-url`. If that fails, `/station` falls back to
`/api/agent/config` and connects with the public `agentId` (works only if the
agent allows unauthenticated connections).

## MongoDB Atlas

Optional. Leave `MONGODB_URI` blank and everything runs in memory as before. Set
it and:

- `saveSession` writes one document per completed session to the `sessions`
  collection (shape from the brief, section 5). Write failures are logged, never
  block the founder.
- On startup the server aggregates today's sessions by category and hydrates the
  `/panel` count, so it survives a restart. During a run the count updates live
  from the in-memory `stats`.

## Still stubbed

In `server/integrations.ts` (marked `TODO`):

- `sendFollowUpEmail` — logs. Swap for the real email + recording link.
- `fetchConversationAudio` — returns a mock URL. Swap for the ElevenLabs
  conversation audio endpoint, called server-side after the founder leaves.

## Where to change things

- Questions, categories, banned words, timings: `shared/constants.ts`
- Roast validation (length + denylist): `shared/validate.ts`
- Roast reveal timing on `/audience`: `computeRevealSchedule` in
  `client/src/lib/reveal.ts` — swap the word-count estimate for the agent's
  `onAudioAlignment` data.
- Mock roasts for the fake session: `server/mockRoasts.ts`

## Smoke checks

```bash
npx tsx scripts/smoke.ts     # runs the state machine through a full session
npm run typecheck
```
