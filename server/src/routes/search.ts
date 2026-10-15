import type { FastifyInstance } from 'fastify';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { config } from '../config.js';
import { search, type SearchSource } from '../services/search.js';
import { resolveStream, type StreamInfo } from '../services/ytdlp.js';
import { currentUser } from '../auth.js';

const SOURCES: SearchSource[] = ['youtube', 'ytmusic', 'soundcloud', 'library'];

const streamCache = new Map<string, { at: number; info: Promise<StreamInfo> }>();
const STREAM_TTL = 20 * 60_000;
/** googlevideo throttles or rejects large open-ended ranges, so we fetch in chunks. */
const CHUNK = 8 * 1024 * 1024;

/** Cached and de-duplicated: a warm-up and the real play request share one yt-dlp lookup. */
function getStream(url: string, fresh = false): Promise<StreamInfo> {
  const hit = streamCache.get(url);
  if (!fresh && hit && Date.now() - hit.at < STREAM_TTL) return hit.info;
  const info = resolveStream(url);
  streamCache.set(url, { at: Date.now(), info });
  info.catch(() => streamCache.delete(url));
  if (streamCache.size > 200) streamCache.delete(streamCache.keys().next().value!);
  return info;
}

const imgCache = new Map<string, { type: string; body: Buffer }>();

const MIME: Record<string, string> = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', mp3: 'audio/mpeg', opus: 'audio/ogg', ogg: 'audio/ogg' };

export default async function searchRoutes(app: FastifyInstance) {
  app.get('/api/search', async (req, reply) => {
    const { q, source } = req.query as { q?: string; source?: SearchSource };
    if (!q) return [];
    if (!source || !SOURCES.includes(source)) return reply.code(400).send({ error: 'Unknown source' });
    try {
      return await search(q, source, currentUser(req).id);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  /** Proxies remote artwork so the browser can read its colors (canvas needs same-origin images). */
  app.get('/api/img', async (req, reply) => {
    const { url } = req.query as { url?: string };
    if (!url || !/^https?:\/\//.test(url)) return reply.code(400).send({ error: 'Missing url' });
    const hit = imgCache.get(url);
    if (hit) {
      reply.header('content-type', hit.type).header('cache-control', 'public, max-age=86400');
      return reply.send(hit.body);
    }
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } }).catch(() => null);
    const type = res?.headers.get('content-type') ?? '';
    if (!res?.ok || !type.startsWith('image/')) return reply.code(502).send({ error: 'Image unavailable' });
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length < 2_000_000) {
      imgCache.set(url, { type, body });
      if (imgCache.size > 400) imgCache.delete(imgCache.keys().next().value!);
    }
    reply.header('content-type', type).header('cache-control', 'public, max-age=86400');
    return reply.send(body);
  });

  /** Starts looking up a stream URL early (on hover / for the next queued song) so playback starts instantly. */
  app.post('/api/preview/warm', async (req) => {
    const { url } = req.body as { url?: string };
    if (url && /^https?:\/\//.test(url)) getStream(url).catch(() => {});
    return { ok: true };
  });

  /** Streams a search result straight from its source, without downloading it into the library. */
  app.get('/api/preview', async (req, reply) => {
    const { url } = req.query as { url?: string };
    if (!url || !/^https?:\/\//.test(url)) return reply.code(400).send({ error: 'Missing url' });

    let info: StreamInfo;
    try {
      info = await getStream(url);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }

    if (!info.protocol.startsWith('http')) {
      // HLS/DASH manifests: let ffmpeg turn them into a plain MP3 stream (no seeking).
      const ff = spawn(config.ffmpeg, ['-loglevel', 'error', '-i', info.url, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', 'pipe:1'], {
        windowsHide: true,
      });
      req.raw.on('close', () => ff.kill('SIGKILL'));
      reply.type('audio/mpeg');
      return reply.send(ff.stdout);
    }

    const fetchUpstream = async (stream: StreamInfo) => {
      const headers: Record<string, string> = { ...stream.headers };
      const range = req.headers.range;
      if (range) {
        const m = range.match(/bytes=(\d+)-(\d*)/);
        if (m && stream.url.includes('googlevideo.com')) {
          const start = Number(m[1]);
          const end = m[2] ? Math.min(Number(m[2]), start + CHUNK - 1) : start + CHUNK - 1;
          headers.range = `bytes=${start}-${end}`;
        } else headers.range = range;
      }
      return fetch(stream.url, { headers });
    };

    let upstream = await fetchUpstream(info);
    if (upstream.status === 403 || upstream.status === 410) {
      info = await getStream(url, true);
      upstream = await fetchUpstream(info);
    }
    if (!upstream.ok || !upstream.body) return reply.code(502).send({ error: `Source returned ${upstream.status}` });

    reply.code(upstream.status);
    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) reply.header(h, v);
    }
    const ct = upstream.headers.get('content-type');
    reply.header('content-type', ct && ct.startsWith('audio') ? ct : MIME[info.ext] ?? 'audio/mpeg');
    reply.header('cache-control', 'no-store');
    const body = Readable.fromWeb(upstream.body as any);
    req.raw.on('close', () => body.destroy());
    return reply.send(body);
  });
}
