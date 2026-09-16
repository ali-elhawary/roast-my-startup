import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { Command } from '../shared/types';
import { addClient, dispatch, setStats } from './session';
import { runFakeSession, type FakeVariant } from './fakeSession';
import { aggregateTodayStats, connectDb, ensureIndexes, isAtlasEnabled } from './db';
import { RECORDINGS_DIR } from './recordings';
import { flushQueue, startQueueFlusher } from './writeQueue';
import agentRouter from './routes/agent';
import adminRouter from './routes/admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.use(express.json());

app.use('/api/agent', agentRouter);
app.use('/api/admin', adminRouter);

// Serve saved conversation recordings on the local network (booth-grade host;
// swap for S3/GCS signed URLs in production).
app.use('/recordings', express.static(RECORDINGS_DIR));

// Drives the operator's "run fake session" button. Kept server-side so the
// fake session dispatches the exact same commands a real client would.
app.post('/api/dev/fake-session', (req, res) => {
  const variant: FakeVariant = req.body?.variant === 'banned' ? 'banned' : 'pass';
  runFakeSession(variant, dispatch);
  res.json({ ok: true, variant });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  addClient(ws);
  ws.on('message', (raw) => {
    let command: Command;
    try {
      command = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!command || typeof command.type !== 'string') return;
    dispatch(command);
  });
});

// In production the same server serves the built static bundle and the
// WebSocket on one port.
if (isProd) {
  const dist = path.resolve(__dirname, '../dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

server.listen(PORT, async () => {
  console.log(`[server] http://localhost:${PORT}  (prod=${isProd})`);

  // Optional Atlas: connect and hydrate today's /panel count so it survives a
  // restart. If MONGODB_URI is unset or unreachable, stay in-memory.
  if (isAtlasEnabled()) {
    await connectDb();
    await ensureIndexes();
    const stats = await aggregateTodayStats();
    if (stats) {
      setStats(stats);
      console.log(`[db] hydrated stats: ${stats.sessionsToday} sessions today`);
    }
    // Flush any writes that failed while Atlas was unreachable, then keep
    // retrying on an interval.
    await flushQueue();
    startQueueFlusher();
  }
});
