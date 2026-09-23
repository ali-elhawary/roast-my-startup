// Minimal hosted player page for the emailed video link. Dark, phone-friendly,
// shows the MP4 with the caption track. Booth-grade; a production build would
// likely serve this from a CDN with signed URLs.

// Shared dark player shell. Local mode (watchPage) serves this straight from the
// Node server at /watch/:id; cloud mode (videoPlayerPage) renders the same shell
// with signed URLs, then uploads the HTML to GCS as the watch destination.
function renderPlayer(opts: {
  streamUrl: string;
  vttUrl: string | null;
  downloadUrl?: string | null;
}): string {
  const { streamUrl, vttUrl, downloadUrl } = opts;
  const track = vttUrl
    ? `<track kind="captions" src="${vttUrl}" srclang="en" label="English" default />`
    : '';
  const downloadButton = downloadUrl
    ? `<a class="download" href="${downloadUrl}">Download the video</a>`
    : '';
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
    a.download { display: inline-block; text-decoration: none; font-weight: 700;
      color: #0a0a0b; background: #39FF6A; padding: 10px 18px; border-radius: 10px; }
    a.download:hover { background: #57ff82; }
    p.note { color: #5c5c66; font-size: 0.9rem; text-align: center; max-width: 40ch; }
  </style>
</head>
<body>
  <div class="brand"><b>MongoDB</b> &times; <b>Google Cloud</b> &times; <b>ElevenLabs</b></div>
  <h1>Your <span class="accent">roast</span>, on the record.</h1>
  <video controls playsinline preload="metadata">
    <source src="${streamUrl}" type="video/mp4" />
    ${track}
    Your browser can't play this video. Download it: <a href="${downloadUrl || streamUrl}">here</a>
  </video>
  ${downloadButton}
  <p class="note">Turn on captions with the CC button. This link expires; save the
  video if you want to keep it.</p>
</body>
</html>`;
}

// Local mode: server-rendered player served at /watch/:id, pointing at the
// statically-hosted /videos files.
export function watchPage(sessionId: string): string {
  const safe = encodeURIComponent(sessionId);
  return renderPlayer({
    streamUrl: `/videos/${safe}.mp4`,
    vttUrl: `/videos/${safe}.vtt`,
    downloadUrl: `/videos/${safe}.mp4`,
  });
}

// Cloud mode: same player, rendered with GCS signed URLs and uploaded as the
// watch destination. A visible Download button/link is shown when provided.
export function videoPlayerPage({
  streamUrl,
  vttUrl,
  downloadUrl,
}: {
  streamUrl: string;
  vttUrl: string | null;
  downloadUrl?: string | null;
}): string {
  return renderPlayer({ streamUrl, vttUrl, downloadUrl });
}
