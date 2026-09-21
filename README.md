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

## Follow-up: recording + transcript + email

On `complete`, the server saves the session doc, then `server/followup.ts` runs
asynchronously (well after the founder leaves): it polls ElevenLabs until the
recording is finalized, downloads the MP3 and hosts it under `/recordings`,
folds the transcript + recording link into the Atlas doc, and emails the
founder.

- Email send is in **preview mode**: `server/email.ts` composes the real subject
  and body and writes a `.eml` to `./outbox` (and logs a line). Swap the
  `deliver()` body for SMTP / Resend / SendGrid — composition stays the same.
- Recordings are hosted by the Node server on the LAN (booth-grade). For
  production, change `saveRecording` to upload to S3/GCS and return a signed URL.
  Set `PUBLIC_BASE_URL` so the emailed link is reachable.
- Real MongoDB for Startups email copy is a `TODO` in `server/email.ts`.

## Video (Option 1: in-app capture)

When `VIDEO_ENABLED=true` (and `VITE_VIDEO_ENABLED=true` for the client), `/station`
records the selected camera + mic with `MediaRecorder` for the length of the live
session and uploads the clip when the session ends. The server then:

1. transcodes it to a phone-playable MP4 (`ffmpeg-static`, H.264/AAC, 720p),
2. builds a WebVTT caption track from the transcript's `time_in_call_secs`
   (`buildVtt` in `server/video.ts`), aligned to the video via an offset,
3. hosts both under `/videos`, exposes a player page at `/watch/:sessionId`,
   records `video` on the Atlas doc, and emails the founder the watch link.

When video is on, the audio-only follow-up email is suppressed (the video is the
deliverable); the transcript/audio are still saved to the session doc.

- Pick the capture device (e.g. a capture-card feed from a nicer camera) with the
  camera dropdown on `/station` while idle/ready.
- `processSessionVideo(file, meta)` in `server/video.ts` is **source-agnostic**, so
  an OBS adapter can later call it with a file OBS recorded instead of a browser
  upload — no changes to the transcode/caption/host/email tail.
- Recordings/videos are booth-grade local hosting; swap for S3/GCS in production.

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
