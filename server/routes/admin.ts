// Admin endpoints, guarded by ADMIN_TOKEN. Disabled (403) when ADMIN_TOKEN is
// unset so a booth on a public network never exposes an open deletion route.

import { Router } from 'express';
import { deleteSessions } from '../deletion';

const router = Router();

function requireToken(req: import('express').Request): { ok: boolean; status: number; error?: string } {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return { ok: false, status: 403, error: 'deletion disabled (set ADMIN_TOKEN)' };
  if (req.header('x-admin-token') !== token) return { ok: false, status: 401, error: 'unauthorized' };
  return { ok: true, status: 200 };
}

// POST /api/admin/delete  { sessionId?, email? }
router.post('/delete', async (req, res) => {
  const auth = requireToken(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { sessionId, email } = (req.body ?? {}) as { sessionId?: string; email?: string };
  if (!sessionId && !email) {
    return res.status(400).json({ error: 'provide sessionId or email' });
  }

  try {
    const summary = await deleteSessions({ sessionId, email });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
