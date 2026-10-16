import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, serializeTrack, type TrackRow } from '../db.js';
import { cleanLibraryLeftovers, deleteTracks, getOwnTrack } from '../services/library.js';
import { emit } from '../services/events.js';
import { cancelAll } from '../services/queue.js';
import { badRequest, idList, notFound } from '../http.js';
import { currentUser } from '../auth.js';
import { diskInfo } from '../services/limits.js';
import { thumbWidth, thumbnail } from '../services/thumbs.js';

const SORTS: Record<string, string> = {
  added: 'added_at DESC',
  title: 'title COLLATE NOCASE ASC',
  artist: 'artist COLLATE NOCASE ASC, album COLLATE NOCASE ASC, title COLLATE NOCASE ASC',
  album: 'album COLLATE NOCASE ASC, title COLLATE NOCASE ASC',
  played: 'last_played_at DESC NULLS LAST',
  plays: 'play_count DESC, last_played_at DESC',
  duration: 'duration DESC',
};

/** Saves a data: URL image into the data folder and returns its file name. */
export function saveDataUrl(dataUrl: string, name: string): string {
  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
  if (!m) throw badRequest('Cover must be a PNG, JPG, WebP or GIF image');
  const dir = path.join(config.dataDir, 'covers');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith(name + '.')) fs.rmSync(path.join(dir, f), { force: true });
  const file = `${name}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(dir, file), Buffer.from(m[2], 'base64'));
  return file;
}

const trackId = (req: { params: unknown }) => Number((req.params as { id: string }).id);

export default async function libraryRoutes(app: FastifyInstance) {
  app.get('/api/tracks', async (req) => {
    const user = currentUser(req);
    const q = req.query as { sort?: string; liked?: string; q?: string; artist?: string; album?: string };
    const where: string[] = ['user_id = ?'];
    const params: unknown[] = [user.id];
    if (q.liked === '1') where.push('liked = 1');
    if (q.artist) {
      where.push('artist = ?');
      params.push(q.artist);
    }
    if (q.album) {
      where.push('album = ?');
      params.push(q.album);
    }
    if (q.q) {
      where.push('(title LIKE ? OR artist LIKE ? OR album LIKE ?)');
      const like = `%${q.q}%`;
      params.push(like, like, like);
    }
    const order = SORTS[q.sort ?? 'added'] ?? SORTS.added;
    const rows = db.prepare(`SELECT * FROM tracks WHERE ${where.join(' AND ')} ORDER BY ${order}`).all(...params) as TrackRow[];
    return rows.map(serializeTrack);
  });

  app.get('/api/home', async (req) => {
    const { id } = currentUser(req);
    const recent = db.prepare('SELECT * FROM tracks WHERE user_id = ? ORDER BY added_at DESC LIMIT 24').all(id) as TrackRow[];
    const played = db
      .prepare('SELECT * FROM tracks WHERE user_id = ? AND last_played_at IS NOT NULL ORDER BY last_played_at DESC LIMIT 24')
      .all(id) as TrackRow[];
    const top = db.prepare('SELECT * FROM tracks WHERE user_id = ? AND play_count > 0 ORDER BY play_count DESC LIMIT 24').all(id) as TrackRow[];
    const stats = db
      .prepare('SELECT COUNT(*) AS tracks, COALESCE(SUM(duration),0) AS seconds, COUNT(DISTINCT artist) AS artists FROM tracks WHERE user_id = ?')
      .get(id);
    return {
      recentlyAdded: recent.map(serializeTrack),
      recentlyPlayed: played.map(serializeTrack),
      mostPlayed: top.map(serializeTrack),
      stats,
    };
  });

  app.get('/api/albums', async (req) => {
    const rows = db
      .prepare(
        `SELECT album, artist, COUNT(*) AS count, MIN(id) AS coverTrack, MAX(added_at) AS addedAt
         FROM tracks WHERE user_id = ? AND album IS NOT NULL AND album != ''
         GROUP BY album COLLATE NOCASE ORDER BY addedAt DESC`,
      )
      .all(currentUser(req).id) as { album: string; artist: string; count: number; coverTrack: number; addedAt: number }[];
    return rows.map((r) => ({ ...r, cover: `/api/cover/${r.coverTrack}` }));
  });

  app.get('/api/artists', async (req) => {
    const rows = db
      .prepare(
        `SELECT artist, COUNT(*) AS count, MAX(id) AS coverTrack FROM tracks WHERE user_id = ?
         GROUP BY artist COLLATE NOCASE ORDER BY artist COLLATE NOCASE`,
      )
      .all(currentUser(req).id) as { artist: string; count: number; coverTrack: number }[];
    return rows.map((r) => ({ ...r, cover: `/api/cover/${r.coverTrack}` }));
  });

  app.get('/api/tracks/:id', async (req) => {
    const t = getOwnTrack(currentUser(req).id, trackId(req));
    if (!t) throw notFound('Track not found');
    return serializeTrack(t);
  });

  app.patch('/api/tracks/:id', async (req) => {
    const user = currentUser(req);
    const id = trackId(req);
    const t = getOwnTrack(user.id, id);
    if (!t) throw notFound('Track not found');
    const body = (req.body ?? {}) as { title?: string; artist?: string; album?: string | null; liked?: boolean; cover?: string };
    const patch: Record<string, unknown> = {};
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
    if (typeof body.artist === 'string' && body.artist.trim()) patch.artist = body.artist.trim();
    if (body.album !== undefined) patch.album = body.album?.trim() || null;
    if (typeof body.liked === 'boolean') patch.liked = body.liked ? 1 : 0;
    if (body.cover) {
      const file = saveDataUrl(body.cover, `track-${id}`);
      patch.cover_path = path.relative(config.libraryDir, path.join(config.dataDir, 'covers', file));
      patch.added_at = t.added_at + 1; // bust the browser cache for /api/cover
    }
    const keys = Object.keys(patch);
    if (keys.length) db.prepare(`UPDATE tracks SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...patch, id });
    emit(user.id, { type: 'library' });
    return serializeTrack(getOwnTrack(user.id, id)!);
  });

  app.post('/api/tracks/:id/play', async (req) => {
    db.prepare('UPDATE tracks SET play_count = play_count + 1, last_played_at = ? WHERE id = ? AND user_id = ?').run(
      Date.now(),
      trackId(req),
      currentUser(req).id,
    );
    return { ok: true };
  });

  app.delete('/api/tracks/:id', async (req) => deleteTracks([trackId(req)], currentUser(req).id));

  /** This account's songs with their size on disk and its storage limit, for Settings → Storage. */
  app.get('/api/storage', async (req) => {
    const user = currentUser(req);
    const rows = db.prepare('SELECT * FROM tracks WHERE user_id = ? ORDER BY added_at DESC').all(user.id) as TrackRow[];
    const tracks = rows.map((t) => ({ ...serializeTrack(t), size: t.size }));
    const disk = user.isAdmin ? diskInfo() : null;
    const playlists = (db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE user_id = ?').get(user.id) as { n: number }).n;
    const totalSize = tracks.reduce((a, t) => a + t.size, 0);
    return { tracks, totalSize, quota: user.quotaBytes, disk, playlists };
  });

  app.post('/api/tracks/delete', async (req) => {
    const ids = idList((req.body as { trackIds?: unknown })?.trackIds);
    return deleteTracks(ids, currentUser(req).id);
  });

  /**
   * Deletes every song in this account. Requires { confirm: "DELETE" } so it can't happen by accident.
   * Also stops this account's downloads in progress (otherwise songs would keep appearing) and cleans partial files.
   */
  app.post('/api/library/clear', async (req) => {
    const user = currentUser(req);
    const body = (req.body ?? {}) as { confirm?: string; deletePlaylists?: boolean; clearHistory?: boolean };
    if (body.confirm !== 'DELETE') throw badRequest('Confirmation missing');
    cancelAll(user.id);
    const ids = (db.prepare('SELECT id FROM tracks WHERE user_id = ?').all(user.id) as { id: number }[]).map((r) => r.id);
    const result = deleteTracks(ids, user.id);
    const freed = result.freed + cleanLibraryLeftovers(user.id);
    if (body.deletePlaylists) {
      db.prepare('DELETE FROM playlists WHERE user_id = ?').run(user.id);
      emit(user.id, { type: 'playlists' });
    }
    if (body.clearHistory) {
      db.prepare(`DELETE FROM jobs WHERE user_id = ? AND status NOT IN ('queued','running')`).run(user.id);
      emit(user.id, { type: 'jobs-cleared' });
    }
    return { deleted: result.deleted, freed };
  });

  app.get('/api/stream/:id', async (req, reply) => {
    const t = getOwnTrack(currentUser(req).id, trackId(req));
    if (!t) throw notFound('Track not found');
    const abs = path.resolve(config.libraryDir, t.file_path);
    reply.header('cache-control', 'private, max-age=86400');
    return reply.sendFile(path.basename(abs), path.dirname(abs));
  });

  app.get('/api/cover/:id', async (req, reply) => {
    const t = getOwnTrack(currentUser(req).id, trackId(req));
    if (!t?.cover_path) throw notFound('No cover');
    // Custom covers live in the data folder, downloaded ones next to the audio file.
    const abs = path.resolve(config.libraryDir, t.cover_path);
    // private: covers belong to one account, so shared caches (Cloudflare) must not keep them.
    reply.header('cache-control', 'private, max-age=604800');
    // ?w=128|256|512 sends a small copy instead of the full-size cover.
    const width = thumbWidth((req.query as { w?: string }).w);
    const small = width ? await thumbnail(abs, width) : null;
    if (small) return reply.sendFile(path.basename(small), path.dirname(small));
    return reply.sendFile(path.basename(abs), path.dirname(abs));
  });

  /** Custom covers (track-<id>.jpg, playlist-<id>.jpg), only for their owner. */
  app.get('/api/files/covers/:file', async (req, reply) => {
    const user = currentUser(req);
    const file = path.basename((req.params as { file: string }).file);
    const m = file.match(/^(track|playlist)-(\d+)\./);
    const table = m?.[1] === 'track' ? 'tracks' : 'playlists';
    if (!m || !db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).get(Number(m[2]), user.id)) throw notFound('Not found');
    reply.header('cache-control', 'private, max-age=604800');
    const width = thumbWidth((req.query as { w?: string }).w);
    const small = width ? await thumbnail(path.join(config.dataDir, 'covers', file), width) : null;
    if (small) return reply.sendFile(path.basename(small), path.dirname(small));
    return reply.sendFile(file, path.join(config.dataDir, 'covers'));
  });
}
