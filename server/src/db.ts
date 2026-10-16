import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// The app used to be called Vide: carry an existing vide.db (and its WAL files) over to tuno.db once.
const dbPath = path.join(config.dataDir, 'tuno.db');
const legacyPath = path.join(config.dataDir, 'vide.db');
if (!fs.existsSync(dbPath) && fs.existsSync(legacyPath)) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(legacyPath + suffix)) fs.renameSync(legacyPath + suffix, dbPath + suffix);
  }
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL'); // safe with WAL, much faster writes during big imports
db.pragma('cache_size = -16000'); // 16 MB page cache

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  quota_bytes   INTEGER NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS tracks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  source_url    TEXT NOT NULL,
  title         TEXT NOT NULL,
  artist        TEXT NOT NULL DEFAULT 'Unknown artist',
  album         TEXT,
  duration      REAL,
  file_path     TEXT NOT NULL,
  cover_path    TEXT,
  size          INTEGER NOT NULL DEFAULT 0,
  liked         INTEGER NOT NULL DEFAULT 0,
  play_count    INTEGER NOT NULL DEFAULT 0,
  last_played_at INTEGER,
  added_at      INTEGER NOT NULL,
  UNIQUE(user_id, source, source_id)
);

CREATE TABLE IF NOT EXISTS playlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  cover_url   TEXT,
  source_url  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position    REAL NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'queued',
  url         TEXT,
  query       TEXT,
  source      TEXT,
  source_id   TEXT,
  title       TEXT,
  artist      TEXT,
  album       TEXT,
  thumbnail   TEXT,
  duration_hint REAL,
  playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
  position    REAL,
  track_id    INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
  progress    REAL NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// ---- Migrations for databases created before accounts existed ----
const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

if (!columns('tracks').includes('user_id')) {
  // Songs become per-account: the same song can exist once per user, so the UNIQUE rule changes.
  // SQLite can't alter a UNIQUE constraint, so rebuild the table (same ids, so playlists stay intact).
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE tracks_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        source TEXT NOT NULL, source_id TEXT NOT NULL, source_url TEXT NOT NULL,
        title TEXT NOT NULL, artist TEXT NOT NULL DEFAULT 'Unknown artist', album TEXT, duration REAL,
        file_path TEXT NOT NULL, cover_path TEXT, size INTEGER NOT NULL DEFAULT 0,
        liked INTEGER NOT NULL DEFAULT 0, play_count INTEGER NOT NULL DEFAULT 0, last_played_at INTEGER,
        added_at INTEGER NOT NULL,
        UNIQUE(user_id, source, source_id)
      );
      INSERT INTO tracks_new (id, source, source_id, source_url, title, artist, album, duration, file_path, cover_path,
                              liked, play_count, last_played_at, added_at)
        SELECT id, source, source_id, source_url, title, artist, album, duration, file_path, cover_path,
               liked, play_count, last_played_at, added_at FROM tracks;
      DROP TABLE tracks;
      ALTER TABLE tracks_new RENAME TO tracks;
    `);
  })();
  db.pragma('foreign_keys = ON');
}
for (const table of ['playlists', 'jobs']) {
  if (!columns(table).includes('user_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
}

db.exec(`
CREATE INDEX IF NOT EXISTS tracks_user ON tracks(user_id, added_at);
CREATE INDEX IF NOT EXISTS tracks_artist ON tracks(artist);
CREATE INDEX IF NOT EXISTS tracks_album ON tracks(album);
CREATE INDEX IF NOT EXISTS tracks_liked ON tracks(liked) WHERE liked = 1;
CREATE INDEX IF NOT EXISTS playlists_user ON playlists(user_id);
CREATE INDEX IF NOT EXISTS jobs_user ON jobs(user_id, status);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_playlist ON jobs(playlist_id, status);
CREATE INDEX IF NOT EXISTS playlist_tracks_track ON playlist_tracks(track_id);
CREATE INDEX IF NOT EXISTS playlist_tracks_order ON playlist_tracks(playlist_id, position);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
`);

// Jobs that were mid-download when the server stopped go back in the queue.
db.prepare(`UPDATE jobs SET status = 'queued', progress = 0 WHERE status = 'running'`).run();

export interface UserRow {
  id: number;
  name: string;
  password_hash: string;
  quota_bytes: number;
  is_admin: number;
  created_at: number;
}

export interface TrackRow {
  id: number;
  user_id: number | null;
  size: number;
  source: string;
  source_id: string;
  source_url: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  file_path: string;
  cover_path: string | null;
  liked: number;
  play_count: number;
  last_played_at: number | null;
  added_at: number;
}

export interface PlaylistRow {
  id: number;
  user_id: number | null;
  name: string;
  description: string | null;
  cover_url: string | null;
  source_url: string | null;
  created_at: number;
  updated_at: number;
}

export interface JobRow {
  id: number;
  user_id: number | null;
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled';
  url: string | null;
  query: string | null;
  source: string | null;
  source_id: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  thumbnail: string | null;
  duration_hint: number | null;
  playlist_id: number | null;
  position: number | null;
  track_id: number | null;
  progress: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

/** Per-account settings (e.g. the theme). */
export function getUserSetting<T>(userId: number, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setUserSetting(userId: number, key: string, value: unknown) {
  db.prepare(
    'INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
  ).run(userId, key, JSON.stringify(value));
}

/**
 * Gives everything created before accounts existed (songs, playlists, downloads, the theme) to one user.
 * Called when the first admin account is created.
 */
export function claimUnownedData(userId: number) {
  db.transaction(() => {
    for (const table of ['tracks', 'playlists', 'jobs']) db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(userId);
    const theme = db.prepare(`SELECT value FROM settings WHERE key = 'theme'`).get() as { value: string } | undefined;
    if (theme) {
      db.prepare(`INSERT OR IGNORE INTO user_settings (user_id, key, value) VALUES (?, 'theme', ?)`).run(userId, theme.value);
    }
  })();
}

/** Public shape of a track sent to the browser. */
export function serializeTrack(t: TrackRow) {
  return {
    id: t.id,
    source: t.source,
    sourceId: t.source_id,
    sourceUrl: t.source_url,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    cover: t.cover_path ? `/api/cover/${t.id}?v=${t.added_at}` : null,
    liked: !!t.liked,
    playCount: t.play_count,
    lastPlayedAt: t.last_played_at,
    addedAt: t.added_at,
  };
}

const jobTrackCover = db.prepare('SELECT cover_path, added_at FROM tracks WHERE id = ?');

/** Jobs show the song's own artwork: the saved track's cover once it exists, otherwise the thumbnail found for that song. */
export function serializeJob(j: JobRow) {
  let thumbnail = j.thumbnail;
  if (j.track_id) {
    const t = jobTrackCover.get(j.track_id) as { cover_path: string | null; added_at: number } | undefined;
    if (t?.cover_path) thumbnail = `/api/cover/${j.track_id}?v=${t.added_at}`;
  }
  return {
    id: j.id,
    status: j.status,
    url: j.url,
    query: j.query,
    source: j.source,
    title: j.title,
    artist: j.artist,
    thumbnail,
    playlistId: j.playlist_id,
    trackId: j.track_id,
    progress: j.progress,
    error: j.error,
    createdAt: j.created_at,
    updatedAt: j.updated_at,
  };
}
