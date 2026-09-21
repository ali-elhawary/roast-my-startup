// Minimal hosted player page for the emailed video link. Dark, phone-friendly,
// shows the MP4 with the caption track. Booth-grade; a production build would
// likely serve this from a CDN with signed URLs.

export function watchPage(sessionId: string): string {
  const safe = encodeURIComponent(sessionId);
  const mp4 = `/videos/${safe}.mp4`;
  const vtt = `/videos/${safe}.vtt`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your Roast My Startup video</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; background: #0a0a0b; color: #d8d8de;
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      display: flex; min-height: 100vh; flex-direction: column;
      align-items: center; justify-content: center; padding: 24px; gap: 20px; }
    .brand { font-weight: 800; letter-spacing: -0.01em; color: #a8a8b3; }
    .brand b { color: #d8d8de; }
    h1 { font-size: 1.5rem; margin: 0; text-align: center; }
    .accent { color: #39FF6A; }
    video { width: min(100%, 900px); border-radius: 12px; background: #000;
      outline: none; }
    /* Keep captions to a small, unobtrusive band at the bottom. */
    video::cue {
      font-size: 0.85rem;
      line-height: 1.25;
      color: #fff;
      background: rgba(0, 0, 0, 0.55);
    }
    p.note { color: #5c5c66; font-size: 0.9rem; text-align: center; max-width: 40ch; }
  </style>
</head>
<body>
  <div class="brand"><b>MongoDB</b> &times; <b>Google</b> &times; <b>ElevenLabs</b></div>
  <h1>Your <span class="accent">roast</span>, on the record.</h1>
  <video controls playsinline preload="metadata">
    <source src="${mp4}" type="video/mp4" />
    <track kind="captions" src="${vtt}" srclang="en" label="English" default />
    Your browser can't play this video. Download it: <a href="${mp4}">${mp4}</a>
  </video>
  <p class="note">Turn on captions with the CC button. This link expires; save the
  video if you want to keep it.</p>
</body>
</html>`;
}
