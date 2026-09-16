// Signed-URL endpoint. The ElevenLabs API key must never reach the browser;
// the client fetches a short-lived signed URL from here and passes it to
// startSession.

import { Router } from 'express';

const router = Router();

router.get('/signed-url', async (_req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!apiKey || !agentId) {
    return res
      .status(500)
      .json({ error: 'Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID' });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
      { headers: { 'xi-api-key': apiKey } },
    );
    if (!response.ok) {
      return res.status(500).json({ error: 'Failed to get signed URL' });
    }
    const body = (await response.json()) as { signed_url: string };
    res.json({ signedUrl: body.signed_url });
  } catch {
    res.status(500).json({ error: 'Failed to get signed URL' });
  }
});

export default router;
