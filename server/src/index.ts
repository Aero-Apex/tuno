import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import './db.js';
import libraryRoutes from './routes/library.js';
import playlistRoutes from './routes/playlists.js';
import jobRoutes from './routes/jobs.js';
import searchRoutes from './routes/search.js';
import settingsRoutes from './routes/settings.js';
import updateRoutes from './routes/updates.js';
import adminRoutes from './routes/admin.js';
import assistantRoutes from './routes/assistant.js';
import { startQueue } from './services/queue.js';
import { backfillSizes, sweepPartials } from './services/library.js';
import { HttpError } from './http.js';
import { authPlugin } from './auth.js';
import { sweepThumbs } from './services/thumbs.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  disableRequestLogging: true,
  bodyLimit: 20 * 1024 * 1024,
});

const hasWeb = fs.existsSync(path.join(config.webDist, 'index.html'));

// Must be set before the route plugins are registered, or they won't inherit it.
app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
  const status = err.statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  reply.code(status).send({ error: status >= 500 && !(err instanceof HttpError) ? 'Something went wrong on the server' : err.message });
});

// Library lists are re-requested after every change event. With an ETag the browser/app gets a tiny "304 not
// modified" when nothing changed instead of the whole list again. Registered before compression so it sees plain JSON.
const ETAG_ROUTES = /^\/api\/(tracks|home|albums|artists|playlists|storage)(\/\d+)?(\?|$)/;
app.addHook('onSend', async (req, reply, payload) => {
  if (req.method !== 'GET' || reply.statusCode !== 200 || typeof payload !== 'string' || !ETAG_ROUTES.test(req.url)) return payload;
  const etag = `W/"${crypto.createHash('sha1').update(payload).digest('base64url')}"`;
  reply.header('etag', etag).header('cache-control', 'private, no-cache');
  if (req.headers['if-none-match'] === etag) {
    reply.code(304);
    return '';
  }
  return payload;
});

// gzip/brotli for JSON, JS and CSS. Audio isn't compressible so it's sent as-is,
// and the SSE stream writes to the raw socket so it's never buffered.
await app.register(fastifyCompress, { threshold: 1024 });

// Also gives us reply.sendFile() (with HTTP Range support) for audio streaming.
await app.register(fastifyStatic, {
  root: hasWeb ? config.webDist : config.libraryDir,
  serve: hasWeb,
  wildcard: false,
  index: false,
  // We set cache-control ourselves (below, and per route for covers); the plugin's default would overwrite it.
  cacheControl: false,
  setHeaders: (res, filePath) => {
    // Built assets have content hashes in their names, so browsers can keep them forever.
    if (/[\\/]assets[\\/]/.test(filePath)) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    // Icons, manifest and index.html keep their names between versions: always revalidate, otherwise
    // Cloudflare caches them for hours and keeps serving an old logo after an update.
    else res.setHeader('cache-control', 'no-cache');
  },
});

// Login + the "must be signed in" check for every /api route. Added directly on the root app (not via
// register) so the hook applies to all routes registered after it.
await authPlugin(app);

await app.register(libraryRoutes);
await app.register(playlistRoutes);
await app.register(adminRoutes);
await app.register(jobRoutes);
await app.register(searchRoutes);
await app.register(settingsRoutes);
await app.register(updateRoutes);
await app.register(assistantRoutes);

app.get('/api/health', async () => ({ ok: true }));

app.setNotFoundHandler((req, reply) => {
  // Single-page app: page routes render index.html. Missing API calls and build files are real 404s,
  // so a browser still running an old build gets an error it can recover from instead of HTML.
  if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/assets/') && hasWeb) {
    return reply.type('text/html').header('cache-control', 'no-cache').sendFile('index.html');
  }
  return reply.code(404).send({ error: 'Not found' });
});

backfillSizes(); // storage limits need every song's size
sweepPartials();
sweepThumbs();
setInterval(sweepPartials, 6 * 3_600_000).unref();

await app.listen({ port: config.port, host: config.host });
app.log.info(`Tuno is running on http://localhost:${config.port} (library: ${config.libraryDir})`);
startQueue();
