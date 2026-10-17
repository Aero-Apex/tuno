import type { FastifyInstance } from 'fastify';
import { db, serializeTrack, type PlaylistRow, type TrackRow } from '../db.js';
import { addToPlaylist, createPlaylist, deleteTracks } from '../services/library.js';
import { emit } from '../services/events.js';
import { cancelPlaylistJobs, importUrl } from '../services/queue.js';
import { saveDataUrl } from './library.js';
import { badRequest, idList, notFound } from '../http.js';
import { currentUser } from '../auth.js';

function summary(p: PlaylistRow) {
  const stats = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(t.duration),0) AS duration
       FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ?`,
    )
    .get(p.id) as { count: number; duration: number };
  const covers = (
    db
      .prepare(
        `SELECT t.id, t.added_at FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = ? AND t.cover_path IS NOT NULL ORDER BY pt.position LIMIT 4`,
      )
      .all(p.id) as { id: number; added_at: number }[]
  ).map((t) => `/api/cover/${t.id}?v=${t.added_at}`);
  const pending = (
    db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE playlist_id = ? AND status IN ('queued','running')`).get(p.id) as { n: number }
  ).n;
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    cover: p.cover_url,
    covers,
    sourceUrl: p.source_url,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    count: stats.count,
    duration: stats.duration,
    pending,
  };
}

/** A playlist, only if it belongs to this account. */
function getPlaylist(userId: number, id: number) {
  return db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(id, userId) as PlaylistRow | undefined;
}

function ownPlaylist(req: { params: unknown }, userId: number): PlaylistRow {
  const p = getPlaylist(userId, Number((req.params as { id: string }).id));
  if (!p) throw notFound('Playlist not found');
  return p;
}

export default async function playlistRoutes(app: FastifyInstance) {
  // All playlists in three queries total (instead of three per playlist).
  app.get('/api/playlists', async (req) => {
    const user = currentUser(req);
    const rows = db
      .prepare(
        `SELECT p.*,
           COUNT(t.id) AS count,
           COALESCE(SUM(t.duration), 0) AS duration,
           (SELECT COUNT(*) FROM jobs j WHERE j.playlist_id = p.id AND j.status IN ('queued','running')) AS pending
         FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         LEFT JOIN tracks t ON t.id = pt.track_id
         WHERE p.user_id = ?
         GROUP BY p.id ORDER BY p.updated_at DESC`,
      )
      .all(user.id) as (PlaylistRow & { count: number; duration: number; pending: number })[];
    const covers = new Map<number, string[]>();
    for (const c of db
      .prepare(
        `SELECT playlist_id, id, added_at FROM (
           SELECT pt.playlist_id, t.id, t.added_at, ROW_NUMBER() OVER (PARTITION BY pt.playlist_id ORDER BY pt.position) AS rn
           FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE t.cover_path IS NOT NULL AND t.user_id = ?
         ) WHERE rn <= 4`,
      )
      .all(user.id) as { playlist_id: number; id: number; added_at: number }[]) {
      const list = covers.get(c.playlist_id) ?? [];
      list.push(`/api/cover/${c.id}?v=${c.added_at}`);
      covers.set(c.playlist_id, list);
    }
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      cover: p.cover_url,
      covers: covers.get(p.id) ?? [],
      sourceUrl: p.source_url,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      count: p.count,
      duration: p.duration,
      pending: p.pending,
    }));
  });

  app.post('/api/playlists', async (req) => {
    const user = currentUser(req);
    const body = (req.body ?? {}) as { name?: string; description?: string; trackIds?: unknown };
    const trackIds = body.trackIds === undefined ? [] : idList(body.trackIds);
    const id = createPlaylist(user.id, String(body.name ?? '').trim().slice(0, 200) || 'New playlist', { description: body.description });
    const own = db.prepare('SELECT 1 FROM tracks WHERE id = ? AND user_id = ?');
    for (const tid of trackIds) if (own.get(tid, user.id)) addToPlaylist(id, tid);
    return summary(getPlaylist(user.id, id)!);
  });

  app.get('/api/playlists/:id', async (req) => {
    const p = ownPlaylist(req, currentUser(req).id);
    const tracks = db
      .prepare(
        `SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ? ORDER BY pt.position, pt.rowid`,
      )
      .all(p.id) as TrackRow[];
    return { ...summary(p), tracks: tracks.map(serializeTrack) };
  });

  app.patch('/api/playlists/:id', async (req) => {
    const user = currentUser(req);
    const id = ownPlaylist(req, user.id).id;
    const body = (req.body ?? {}) as { name?: string; description?: string | null; cover?: string | null };
    const patch: Record<string, unknown> = { updated_at: Date.now() };
    if (body.name?.trim()) patch.name = body.name.trim();
    if (body.description !== undefined) patch.description = body.description?.trim() || null;
    if (body.cover === null) patch.cover_url = null;
    else if (body.cover) patch.cover_url = `/api/files/covers/${saveDataUrl(body.cover, `playlist-${id}`)}?v=${Date.now()}`;
    const keys = Object.keys(patch);
    db.prepare(`UPDATE playlists SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...patch, id });
    emit(user.id, { type: 'playlists' });
    return summary(getPlaylist(user.id, id)!);
  });

  app.delete('/api/playlists/:id', async (req) => {
    const user = currentUser(req);
    const id = ownPlaylist(req, user.id).id;
    const { deleteTracks: alsoDeleteSongs } = req.query as { deleteTracks?: string };
    if (alsoDeleteSongs === '1') {
      // Only delete tracks that no other playlist uses.
      const ids = db
        .prepare(
          `SELECT track_id FROM playlist_tracks WHERE playlist_id = ? AND track_id NOT IN
           (SELECT track_id FROM playlist_tracks WHERE playlist_id != ?)`,
        )
        .all(id, id) as { track_id: number }[];
      deleteTracks(ids.map((r) => r.track_id), user.id);
    }
    cancelPlaylistJobs(id);
    db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    emit(user.id, { type: 'playlists' });
    return { ok: true };
  });

  /** Deletes every song in this account's library that isn't in the playlist, including songs that sit in other playlists. */
  app.post('/api/playlists/:id/delete-others', async (req) => {
    const user = currentUser(req);
    const id = ownPlaylist(req, user.id).id;
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM playlist_tracks WHERE playlist_id = ?').get(id) as { n: number };
    // An empty playlist would mean "delete the whole library", so refuse.
    if (!n) throw badRequest('This playlist is empty. Add some songs first, so there is something to keep.');
    const ids = (
      db
        .prepare('SELECT id FROM tracks WHERE user_id = ? AND id NOT IN (SELECT track_id FROM playlist_tracks WHERE playlist_id = ?)')
        .all(user.id, id) as { id: number }[]
    ).map((r) => r.id);
    return { ...deleteTracks(ids, user.id), trackIds: ids };
  });

  app.post('/api/playlists/:id/tracks', async (req) => {
    const user = currentUser(req);
    const id = ownPlaylist(req, user.id).id;
    const trackIds = idList((req.body as { trackIds?: unknown })?.trackIds);
    const own = db.prepare('SELECT 1 FROM tracks WHERE id = ? AND user_id = ?');
    for (const tid of trackIds) if (own.get(tid, user.id)) addToPlaylist(id, tid);
    return { ok: true };
  });

  app.delete('/api/playlists/:id/tracks/:trackId', async (req) => {
    const user = currentUser(req);
    const id = ownPlaylist(req, user.id).id;
    const { trackId } = req.params as { trackId: string };
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(id, Number(trackId));
    // Like adding a song, removing one counts as a change for the "Recents" order.
    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), id);
    emit(user.id, { type: 'playlists' });
    return { ok: true };
  });

  app.put('/api/playlists/:id/order', async (req) => {
    const user = currentUser(req);
    const id = ownPlaylist(req, user.id).id;
    const trackIds = idList((req.body as { trackIds?: unknown })?.trackIds);
    const stmt = db.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?');
    db.transaction(() => trackIds.forEach((tid, i) => stmt.run(i + 1, id, tid)))();
    emit(user.id, { type: 'playlists' });
    return { ok: true };
  });

  app.post('/api/playlists/:id/sync', async (req, reply) => {
    const user = currentUser(req);
    const p = ownPlaylist(req, user.id);
    if (!p.source_url) return reply.code(400).send({ error: 'This playlist was not imported from a link' });
    try {
      return await importUrl(user.id, p.source_url, { playlistId: p.id });
    } catch (err) {
      return reply.code((err as { statusCode?: number }).statusCode ?? 400).send({ error: (err as Error).message });
    }
  });
}
