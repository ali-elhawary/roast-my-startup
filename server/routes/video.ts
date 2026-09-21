// Video upload endpoint. /station POSTs the recorded blob here at session end.
// The body is the raw recording; session metadata rides in query params. We save
// the file and hand it to the source-agnostic processSessionVideo pipeline.

import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Founder, Roast, RoastSource } from '../../shared/types';
import { VIDEOS_DIR, processSessionVideo } from '../video';

const router = Router();

// The raw body parser is applied where this router is mounted (see index.ts).
router.post(
  '/:sessionId',
  async (req, res) => {
    const { sessionId } = req.params;
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'empty body' });
    }

    const conversationId = strOrNull(req.query.conversationId);
    const offsetMs = Number(req.query.offsetMs ?? 0) || 0;
    const founder: Founder | null = req.query.email
      ? {
          name: strOrNull(req.query.name) ?? '',
          email: String(req.query.email),
          consentAt: Number(req.query.consentAt ?? Date.now()) || Date.now(),
        }
      : null;
    const roast: Roast | null = req.query.roastText
      ? {
          text: String(req.query.roastText),
          category: strOrNull(req.query.category) ?? 'other',
          source: (strOrNull(req.query.roastSource) as RoastSource) ?? 'generated',
        }
      : null;

    try {
      await fs.mkdir(VIDEOS_DIR, { recursive: true });
      const sourceFile = path.join(VIDEOS_DIR, `${sessionId}.src`);
      await fs.writeFile(sourceFile, body);
      console.log(`[video] received ${body.length} bytes for ${sessionId}`);

      // Respond immediately; process asynchronously (transcode + captions + email).
      res.json({ ok: true, sessionId, bytes: body.length });
      void processSessionVideo({ sessionId, conversationId, sourceFile, offsetMs, founder, roast });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}

export default router;
