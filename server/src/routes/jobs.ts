import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { subscribe } from '../services/events.js';
import {
  cancelAll,
  cancelJob,
  clearFinished,
  importUrl,
  jobStats,
  listJobs,
  retryFailed,
  retryJob,
} from '../services/queue.js';
import { currentUser } from '../auth.js';

const jobId = (req: { params: unknown }) => Number((req.params as { id: string }).id);

export default async function jobRoutes(app: FastifyInstance) {
  app.post('/api/import', async (req, reply) => {
    const user = currentUser(req);
    const { url, playlistId } = (req.body ?? {}) as { url?: string; playlistId?: number };
    if (!url) return reply.code(400).send({ error: 'Missing link' });
    if (playlistId && !db.prepare('SELECT 1 FROM playlists WHERE id = ? AND user_id = ?').get(playlistId, user.id)) {
      return reply.code(404).send({ error: 'Playlist not found' });
    }
    try {
      return await importUrl(user.id, url, { playlistId });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get('/api/jobs', async (req) => {
    const { id } = currentUser(req);
    return { jobs: listJobs(id), stats: jobStats(id) };
  });
  app.post('/api/jobs/:id/cancel', async (req) => {
    cancelJob(jobId(req), currentUser(req).id);
    return { ok: true };
  });
  app.post('/api/jobs/:id/retry', async (req) => {
    retryJob(jobId(req), currentUser(req).id);
    return { ok: true };
  });
  app.post('/api/jobs/retry-failed', async (req) => {
    retryFailed(currentUser(req).id);
    return { ok: true };
  });
  app.post('/api/jobs/cancel-all', async (req) => {
    cancelAll(currentUser(req).id);
    return { ok: true };
  });
  app.delete('/api/jobs/finished', async (req) => {
    clearFinished(currentUser(req).id);
    return { ok: true };
  });

  /** Server-Sent Events: this account's live job progress and library changes. */
  app.get('/api/events', (req, reply) => {
    const user = currentUser(req);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const unsubscribe = subscribe(user.id, (event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });
}
