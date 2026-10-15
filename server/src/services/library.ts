import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, type TrackRow, type JobRow } from '../db.js';
import { cleanMeta } from './metadata.js';
import type { DownloadedInfo } from './ytdlp.js';
import { emit } from './events.js';

export function sourceKey(extractor?: string | null): string {
  const key = (extractor ?? 'web').toLowerCase();
  if (key.startsWith('youtube')) return 'youtube';
  if (key.startsWith('soundcloud')) return 'soundcloud';
  if (key.startsWith('bandcamp')) return 'bandcamp';
  return key;
}

/** Folder (inside the library) that holds every account's own downloads. */
export const ACCOUNTS_DIR = '_accounts';

/**
 * Each account downloads into its own folder (library/_accounts/<id>/…), so two accounts never share or delete
 * each other's files. Songs downloaded before accounts existed stay where they are, at the library root.
 */
export function userLibraryDir(userId: number): string {
  const dir = path.join(config.libraryDir, ACCOUNTS_DIR, String(userId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function findTrack(userId: number, source: string, sourceId: string): TrackRow | undefined {
  return db.prepare('SELECT * FROM tracks WHERE user_id = ? AND source = ? AND source_id = ?').get(userId, source, sourceId) as
    | TrackRow
    | undefined;
}

export function getTrack(id: number): TrackRow | undefined {
  return db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow | undefined;
}

/** A track only if it belongs to this account. */
export function getOwnTrack(userId: number, id: number): TrackRow | undefined {
  return db.prepare('SELECT * FROM tracks WHERE id = ? AND user_id = ?').get(id, userId) as TrackRow | undefined;
}

/** Records a freshly downloaded file in the job owner's library. Metadata from the job (e.g. Spotify) wins over the upload's. */
export function addDownloadedTrack(info: DownloadedInfo, job: JobRow): TrackRow {
  const userId = job.user_id!;
  const source = sourceKey(info.extractor_key);
  const existing = findTrack(userId, source, info.id);
  if (existing) return existing;

  const filePath = info.filepath ? path.resolve(info.filepath) : '';
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Downloaded file is missing');
  const rel = path.relative(config.libraryDir, filePath);
  const coverAbs = filePath.replace(/\.[^.\\/]+$/, '.jpg');
  const coverRel = fs.existsSync(coverAbs) ? path.relative(config.libraryDir, coverAbs) : null;
  const size = fileSize(filePath) + (coverRel ? fileSize(coverAbs) : 0);

  const cleaned = cleanMeta(info);
  const fromJob = job.query && job.title; // Spotify and other metadata-first imports
  const title = fromJob ? job.title! : cleaned.title;
  const artist = fromJob ? job.artist || cleaned.artist : cleaned.artist;
  const album = (fromJob ? job.album : null) || info.album || null;

  const result = db
    .prepare(
      `INSERT INTO tracks (user_id, source, source_id, source_url, title, artist, album, duration, file_path, cover_path, size, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, source, info.id, info.webpage_url ?? job.url ?? '', title, artist, album, info.duration ?? null, rel, coverRel, size, Date.now());
  emit(userId, { type: 'library' });
  return getTrack(Number(result.lastInsertRowid))!;
}

/**
 * If another account already downloaded this exact song, gives this account its own entry that shares the same
 * file on disk (a hard link): no download, no extra disk space, no CPU. Deleting one account's copy never
 * touches the other's, and the song still counts against each account's own storage limit.
 */
export function reuseFromOtherAccount(job: JobRow, source: string, sourceId: string): TrackRow | null {
  const userId = job.user_id!;
  const donor = db
    .prepare('SELECT * FROM tracks WHERE source = ? AND source_id = ? AND user_id != ? ORDER BY id LIMIT 1')
    .get(source, sourceId, userId) as TrackRow | undefined;
  if (!donor) return null;
  const from = path.resolve(config.libraryDir, donor.file_path);
  if (!fs.existsSync(from)) return null;

  // Same artist folder and file name, inside this account's own folder.
  const parts = path.relative(config.libraryDir, from).split(path.sep);
  if (parts[0] === ACCOUNTS_DIR) parts.splice(0, 2);
  const to = path.join(userLibraryDir(userId), ...parts);
  const fromCover = from.replace(/\.[^.\\/]+$/, '.jpg');
  const toCover = to.replace(/\.[^.\\/]+$/, '.jpg');
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (!fs.existsSync(to)) fs.linkSync(from, to);
    if (fs.existsSync(fromCover) && !fs.existsSync(toCover)) fs.linkSync(fromCover, toCover);
  } catch {
    return null; // e.g. different disks: just download it normally
  }

  const fromJob = job.query && job.title;
  const coverRel = fs.existsSync(toCover) ? path.relative(config.libraryDir, toCover) : null;
  const size = fileSize(to) + (coverRel ? fileSize(toCover) : 0);
  const result = db
    .prepare(
      `INSERT INTO tracks (user_id, source, source_id, source_url, title, artist, album, duration, file_path, cover_path, size, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      source,
      sourceId,
      donor.source_url,
      fromJob ? job.title! : donor.title,
      fromJob ? job.artist || donor.artist : donor.artist,
      (fromJob ? job.album : null) || donor.album,
      donor.duration,
      path.relative(config.libraryDir, to),
      coverRel,
      size,
      Date.now(),
    );
  emit(userId, { type: 'library' });
  return getTrack(Number(result.lastInsertRowid))!;
}

function playlistOwner(playlistId: number): number | null {
  return (db.prepare('SELECT user_id FROM playlists WHERE id = ?').get(playlistId) as { user_id: number | null } | undefined)?.user_id ?? null;
}

export function addToPlaylist(playlistId: number, trackId: number, position?: number | null) {
  const pos =
    position ??
    ((db.prepare('SELECT MAX(position) AS m FROM playlist_tracks WHERE playlist_id = ?').get(playlistId) as { m: number | null }).m ?? 0) + 1;
  db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)').run(playlistId, trackId, pos);
  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlistId);
  emit(playlistOwner(playlistId), { type: 'playlists' });
}

/** Absolute paths of a track's files that are safe to delete (inside the library or data folder). */
function trackFiles(t: TrackRow): string[] {
  const lib = path.resolve(config.libraryDir);
  const data = path.resolve(config.dataDir);
  return [t.file_path, t.cover_path]
    .filter((rel): rel is string => !!rel)
    .map((rel) => path.resolve(config.libraryDir, rel)) // custom covers are stored relative to the library too
    .filter((p) => p.startsWith(lib + path.sep) || p.startsWith(data + path.sep));
}

export function fileSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/** Bytes a track takes on disk (audio + cover). */
export function trackSize(t: TrackRow): number {
  return trackFiles(t).reduce((sum, p) => sum + fileSize(p), 0);
}

/** Fills in sizes for songs recorded before sizes were stored (needed for storage limits). */
export function backfillSizes() {
  const rows = db.prepare('SELECT * FROM tracks WHERE size = 0').all() as TrackRow[];
  const update = db.prepare('UPDATE tracks SET size = ? WHERE id = ?');
  db.transaction(() => rows.forEach((t) => update.run(trackSize(t), t.id)))();
}

/**
 * Deletes tracks (files + database rows) and returns how many were removed and how much space was freed.
 * With a userId, only that account's tracks are touched.
 */
export function deleteTracks(ids: number[], userId: number | null): { deleted: number; freed: number } {
  let deleted = 0;
  let freed = 0;
  const dirs = new Set<string>();
  const owners = new Set<number | null>();
  const remove = db.prepare('DELETE FROM tracks WHERE id = ?');
  for (const id of ids) {
    const t = userId === null ? getTrack(id) : getOwnTrack(userId, id);
    if (!t) continue;
    for (const p of trackFiles(t)) {
      freed += fileSize(p);
      fs.rmSync(p, { force: true });
    }
    dirs.add(path.dirname(path.resolve(config.libraryDir, t.file_path)));
    owners.add(t.user_id);
    remove.run(id);
    deleted++;
  }
  // Remove artist folders that are now empty.
  for (const dir of dirs) {
    try {
      if (dir !== path.resolve(config.libraryDir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      /* already gone */
    }
  }
  for (const owner of owners) {
    emit(owner, { type: 'library' });
    emit(owner, { type: 'playlists' });
  }
  return { deleted, freed };
}

/** Removes leftovers of interrupted downloads (partial files) and empty folders from an account's files. */
export function cleanLibraryLeftovers(userId: number): number {
  let freed = 0;
  const root = path.resolve(config.libraryDir);
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        // Other accounts' folders are off limits (walking the root skips the accounts folder entirely).
        if (dir === root && e.name === ACCOUNTS_DIR) continue;
        walk(p);
        if (fs.readdirSync(p).length === 0) fs.rmdirSync(p);
      } else if (/\.(part|ytdl|temp)$|\.part-Frag\d+$/.test(e.name)) {
        freed += fileSize(p);
        fs.rmSync(p, { force: true });
      }
    }
  };
  try {
    // Accounts created after the switch to accounts only own their folder; the original owner also owns the root.
    const ownsRoot = !!db.prepare(`SELECT 1 FROM tracks WHERE user_id = ? AND file_path NOT LIKE '${ACCOUNTS_DIR}%' LIMIT 1`).get(userId);
    if (ownsRoot) walk(root);
    walk(userLibraryDir(userId));
  } catch {
    /* library missing */
  }
  return freed;
}

/** Deletes partial downloads left behind by crashes or cancels, once they're clearly abandoned (over an hour old). */
export function sweepPartials(): number {
  let freed = 0;
  const cutoff = Date.now() - 3_600_000;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(part|ytdl|temp)$|\.part-Frag\d+$/.test(e.name)) {
        try {
          if (fs.statSync(p).mtimeMs < cutoff) {
            freed += fileSize(p);
            fs.rmSync(p, { force: true });
          }
        } catch {
          /* gone already */
        }
      }
    }
  };
  try {
    walk(config.libraryDir);
  } catch {
    /* library missing */
  }
  return freed;
}

export function createPlaylist(
  userId: number,
  name: string,
  opts: { description?: string; coverUrl?: string; sourceUrl?: string } = {},
): number {
  const now = Date.now();
  const r = db
    .prepare('INSERT INTO playlists (user_id, name, description, cover_url, source_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId, name, opts.description ?? null, opts.coverUrl ?? null, opts.sourceUrl ?? null, now, now);
  emit(userId, { type: 'playlists' });
  return Number(r.lastInsertRowid);
}
