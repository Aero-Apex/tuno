import { config } from '../config.js';
import { db, serializeJob, type JobRow } from '../db.js';
import { emit } from './events.js';
import { addDownloadedTrack, addToPlaylist, createPlaylist, findTrack, reuseFromOtherAccount, sourceKey, userLibraryDir } from './library.js';
import { HttpError } from '../http.js';
import { assertHasRoom } from '../auth.js';
import { cleanMeta } from './metadata.js';
import { matchSong, matchWords } from './search.js';
import { geniusSongWords, isGeniusUrl, titleCase } from './genius.js';
import { isSpotifyUrl, resolveSpotify } from './spotify.js';
import { getSoundCloudTrack } from './soundcloud.js';
import { bestThumb, downloadAudio, probe } from './ytdlp.js';

type NewJob = Partial<Omit<JobRow, 'id' | 'status' | 'created_at' | 'updated_at'>>;

const running = new Map<number, AbortController>();

const MAX_ATTEMPTS = 3;
const TRANSIENT = /HTTP Error (403|429|5\d\d)|timed out|Connection reset|IncompleteRead|Unable to download (video data|webpage)|Remote end closed/i;

function getJob(id: number): JobRow | undefined {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
}

function updateJob(id: number, patch: Partial<JobRow>, broadcast = true) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @__now WHERE id = @__id`).run({
    ...patch,
    __now: Date.now(),
    __id: id,
  });
  if (broadcast) {
    const job = getJob(id);
    if (job) emit(job.user_id, { type: 'job', job: serializeJob(job) });
  }
}

const insertJob = db.prepare(`
  INSERT INTO jobs (user_id, url, query, source, source_id, title, artist, album, thumbnail, duration_hint, playlist_id, position, created_at, updated_at)
  VALUES (@user_id, @url, @query, @source, @source_id, @title, @artist, @album, @thumbnail, @duration_hint, @playlist_id, @position, @now, @now)
`);

/** Most downloads one account may have waiting at once, so a giant import can't flood the queue and the database. */
const MAX_PENDING = 1500;

function assertQueueRoom(userId: number, adding: number) {
  const pending = (db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND status IN ('queued','running')`).get(userId) as { n: number }).n;
  if (pending + adding > MAX_PENDING)
    throw new HttpError(400, `Too many downloads waiting (the limit is ${MAX_PENDING}). Let some finish, or cancel the rest on the Downloads page.`);
}

function enqueue(userId: number, jobs: NewJob[]): number {
  assertQueueRoom(userId, jobs.length);
  const now = Date.now();
  const tx = db.transaction((list: NewJob[]) => {
    for (const j of list) {
      const r = insertJob.run({
        url: null,
        query: null,
        source: null,
        source_id: null,
        title: null,
        artist: null,
        album: null,
        thumbnail: null,
        duration_hint: null,
        playlist_id: null,
        position: null,
        ...j,
        user_id: userId,
        now,
      });
      const job = getJob(Number(r.lastInsertRowid));
      if (job) emit(userId, { type: 'job', job: serializeJob(job) });
    }
  });
  tx(jobs);
  setImmediate(pump);
  return jobs.length;
}

export interface ImportResult {
  kind: 'track' | 'playlist';
  name: string;
  playlistId: number | null;
  queued: number;
  existing: number;
  trackId?: number | null;
}

/** youtube.com/watch?v=…, music.youtube.com/watch?v=…, youtu.be/… — a single video even if a list= is attached. */
export function isSingleVideoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') return u.pathname.length > 1;
    return host === 'youtube.com' && (u.pathname === '/watch' || u.pathname.startsWith('/shorts/')) && !!(u.searchParams.get('v') || u.pathname.startsWith('/shorts/'));
  } catch {
    return false;
  }
}

/** Turns any supported link into download jobs (and a playlist when the link is a collection). */
export async function importUrl(userId: number, url: string, opts: { playlistId?: number } = {}): Promise<ImportResult> {
  url = url.trim();
  if (!/^https?:\/\/|^spotify:/i.test(url)) throw new Error('Paste a full link starting with https://');
  assertHasRoom(userId);

  if (isSpotifyUrl(url)) {
    const col = await resolveSpotify(url);
    if (!col.tracks.length) throw new Error('No tracks found at that Spotify link');
    assertQueueRoom(userId, col.tracks.length); // before creating a playlist that would stay empty
    let playlistId = opts.playlistId ?? null;
    if (col.kind !== 'track' && !playlistId) playlistId = createPlaylist(userId, col.name, { coverUrl: col.cover ?? undefined, sourceUrl: url });
    // Skip songs this playlist already has (Spotify-matched tracks keep Spotify's title/artist) or is still downloading.
    // Checking the playlist itself matters: job history can be cleared, but the songs stay.
    const existingQueries = new Set<string>();
    if (playlistId) {
      for (const r of db.prepare(`SELECT query FROM jobs WHERE playlist_id = ? AND status IN ('queued','running','done')`).all(playlistId) as { query: string | null }[])
        if (r.query) existingQueries.add(r.query.toLowerCase());
      for (const t of db
        .prepare('SELECT t.artist, t.title FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ?')
        .all(playlistId) as { artist: string; title: string }[])
        existingQueries.add(`${t.artist} - ${t.title}`.toLowerCase());
    }
    const jobs: NewJob[] = col.tracks
      .map((t, i) => ({
        query: `${t.artist} - ${t.title}`,
        title: t.title,
        artist: t.artist,
        album: t.album ?? (col.kind === 'album' ? col.name : null),
        // Each song gets its own artwork; a playlist's cover would make every row look the same. Albums share their cover.
        thumbnail: t.cover ?? (col.kind === 'album' || col.kind === 'track' ? col.cover ?? null : null),
        duration_hint: t.durationSec ?? null,
        playlist_id: playlistId,
        position: i + 1,
        source: 'spotify',
      }))
      .filter((j) => !existingQueries.has(j.query.toLowerCase()));
    enqueue(userId, jobs);
    return { kind: col.kind === 'track' ? 'track' : 'playlist', name: col.name, playlistId, queued: jobs.length, existing: col.tracks.length - jobs.length };
  }

  // Genius blocks every non-browser request (403), so find the song from the words in its link instead.
  if (isGeniusUrl(url)) {
    const words = geniusSongWords(url);
    if (!words) throw new Error("Genius pages can't be downloaded. Paste the song's YouTube, SoundCloud or Spotify link, or search for it.");
    const name = titleCase(words);
    enqueue(userId, [{ query: words.join(' '), title: name, source: 'genius', playlist_id: opts.playlistId ?? null }]);
    return { kind: 'track', name, playlistId: opts.playlistId ?? null, queued: 1, existing: 0 };
  }

  // A song link copied from inside a playlist or Mix (watch?v=X&list=Y) means just that song;
  // without this, a Mix link would queue hundreds of songs.
  const info = await probe(url, { noPlaylist: isSingleVideoUrl(url) });

  if (info._type === 'playlist' && info.entries) {
    const entries = info.entries.filter(
      (e): e is NonNullable<typeof e> => !!e && !!(e.url || e.webpage_url) && !/^\[(private|deleted) video\]$/i.test(e.title ?? ''),
    );
    if (!entries.length) throw new Error('That playlist is empty or private');
    assertQueueRoom(userId, entries.length);
    const isAlbum = /browse\/MPREb|list=OLAK5uy|\/album\//i.test(url) || /^Album - /i.test(info.title ?? '');
    const name = (info.title ?? 'Imported playlist').replace(/^Album - /i, '');
    const playlistId =
      opts.playlistId ?? createPlaylist(userId, name, { coverUrl: bestThumb(info.thumbnails, info.thumbnail), sourceUrl: url });
    const inPlaylist = new Set(
      (db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ?').all(playlistId) as { track_id: number }[]).map((r) => r.track_id),
    );
    const pendingUrls = new Set(
      (db.prepare(`SELECT url FROM jobs WHERE playlist_id = ? AND status IN ('queued','running')`).all(playlistId) as { url: string }[]).map((r) => r.url),
    );
    let existing = 0;
    const jobs: NewJob[] = [];
    entries.forEach((e, i) => {
      const source = sourceKey(e.ie_key);
      const owned = e.id ? findTrack(userId, source, e.id) : undefined;
      if (owned) {
        existing++;
        if (!inPlaylist.has(owned.id)) addToPlaylist(playlistId, owned.id, i + 1);
        return;
      }
      const entryUrl = e.webpage_url ?? e.url!;
      if (pendingUrls.has(entryUrl)) return;
      const meta = e.title ? cleanMeta({ title: e.title, artists: e.artists, uploader: e.uploader ?? e.channel }) : null;
      jobs.push({
        url: entryUrl,
        source,
        source_id: e.id ?? null,
        title: meta?.title ?? null,
        artist: meta?.artist ?? null,
        album: isAlbum ? name : null,
        thumbnail: bestThumb(e.thumbnails) ?? null,
        playlist_id: playlistId,
        position: i + 1,
      });
    });
    enqueue(userId, jobs);
    return { kind: 'playlist', name, playlistId, queued: jobs.length, existing };
  }

  const source = sourceKey(info.extractor_key);
  const owned = info.id ? findTrack(userId, source, info.id) : undefined;
  if (owned) {
    if (opts.playlistId) addToPlaylist(opts.playlistId, owned.id);
    return { kind: 'track', name: owned.title, playlistId: opts.playlistId ?? null, queued: 0, existing: 1, trackId: owned.id };
  }
  const meta = cleanMeta(info);
  enqueue(userId, [
    {
      url: info.webpage_url ?? url,
      source,
      source_id: info.id ?? null,
      title: meta.title,
      artist: meta.artist,
      thumbnail: bestThumb(info.thumbnails, info.thumbnail) ?? null,
      duration_hint: info.duration ?? null,
      playlist_id: opts.playlistId ?? null,
    },
  ]);
  return { kind: 'track', name: meta.title, playlistId: opts.playlistId ?? null, queued: 1, existing: 0 };
}

/** Downloads currently running, keyed "user:source:id", so duplicate jobs of one account share one download. */
const inFlight = new Map<string, Promise<number>>();

function throwIfCanceled(signal: AbortSignal) {
  if (signal.aborted) throw new Error('Canceled');
}

/** Waits, but wakes up immediately if the job is canceled. */
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(new Error('Canceled'))), { once: true });
  });
}

async function downloadWithRetry(jobId: number, url: string, signal: AbortSignal): Promise<number> {
  let lastWrite = 0;
  const onProgress = (pct: number) => {
    const now = Date.now();
    if (now - lastWrite < 700 && pct < 100) return;
    lastWrite = now;
    updateJob(jobId, { progress: Math.min(99, pct) });
  };
  for (let attempt = 1; ; attempt++) {
    throwIfCanceled(signal);
    try {
      const job = getJob(jobId)!;
      const info = await downloadAudio(url, onProgress, signal, userLibraryDir(job.user_id!));
      return addDownloadedTrack(info, job).id;
    } catch (err) {
      // YouTube sometimes rejects a media URL (403) or rate-limits; a fresh attempt gets new URLs.
      if (signal.aborted || attempt >= MAX_ATTEMPTS || !TRANSIENT.test((err as Error).message)) throw err;
      await sleep(3000 * attempt, signal);
    }
  }
}

/** Finds a DRM-protected song on YT Music / YouTube by its title, artist and length, and downloads that. */
async function downloadSameSongElsewhere(
  jobId: number,
  source: string | null,
  sourceId: string | null,
  signal: AbortSignal,
  original: Error,
): Promise<number> {
  const job = getJob(jobId)!;
  let title = job.title;
  let artist = job.artist;
  let duration = job.duration_hint;
  // Playlist entries from SoundCloud often lack titles; ask SoundCloud for this track's details.
  if (source && sourceKey(source) === 'soundcloud' && sourceId) {
    const sc = await getSoundCloudTrack(sourceId).catch(() => null);
    if (sc) {
      const meta = cleanMeta({ title: sc.title, artist: sc.artist !== sc.uploader ? sc.artist : undefined, uploader: sc.uploader });
      title = meta.title;
      artist = meta.artist;
      duration = sc.duration || duration;
      updateJob(jobId, { title, artist, thumbnail: job.thumbnail ?? sc.artwork });
    }
  }
  if (!title) throw original;
  throwIfCanceled(signal);
  const match = await matchSong(title, artist ?? '', duration, { skipSoundCloud: true });
  if (!match) throw new Error('This upload is DRM-protected and no copy was found on YouTube Music or YouTube');
  // Keep the original's title/artist for the library entry (query marks it as metadata-first).
  updateJob(jobId, {
    url: match.url,
    source: match.source,
    source_id: match.id,
    query: `${artist} - ${title}`,
    ...(job.thumbnail || !match.thumbnail ? {} : { thumbnail: match.thumbnail }),
  });
  const owned = findTrack(job.user_id!, match.source, match.id);
  if (owned) return owned.id;
  return downloadWithRetry(jobId, match.url, signal);
}

async function runJob(job: JobRow) {
  const ctrl = new AbortController();
  running.set(job.id, ctrl);
  updateJob(job.id, { status: 'running', progress: 0, error: null });
  try {
    let url = job.url;
    let source = job.source;
    let sourceId = job.source_id;

    if (!url && job.query) {
      const match =
        job.source === 'genius' ? await matchWords(job.query.split(/\s+/)) : await matchSong(job.title ?? job.query, job.artist ?? '', job.duration_hint);
      if (!match) throw new Error('No close match on YouTube Music, YouTube or SoundCloud');
      url = match.url;
      source = match.source;
      sourceId = match.id;
      updateJob(job.id, { url, source, source_id: sourceId, ...(job.thumbnail || !match.thumbnail ? {} : { thumbnail: match.thumbnail }) });
    }
    if (!url) throw new Error('Nothing to download');
    throwIfCanceled(ctrl.signal);

    const userId = job.user_id!;
    const key = source && sourceId ? `${userId}:${sourceKey(source)}:${sourceId}` : null;
    const owned = source && sourceId ? findTrack(userId, sourceKey(source), sourceId) : undefined;
    let trackId: number;
    // Another account already has this exact song: share its file instead of downloading it again.
    let shared: ReturnType<typeof reuseFromOtherAccount> = null;
    if (!owned && source && sourceId && !(key && inFlight.has(key))) {
      assertHasRoom(userId);
      shared = reuseFromOtherAccount(getJob(job.id)!, sourceKey(source), sourceId);
    }
    if (owned) {
      trackId = owned.id;
    } else if (shared) {
      trackId = shared.id;
    } else if (key && inFlight.has(key)) {
      // Same song is already downloading for another job (e.g. it's in two playlists): wait for that one.
      trackId = await inFlight.get(key)!;
    } else {
      // Stop when the account is full (songs already in the library above still get linked).
      assertHasRoom(userId);
      const download = downloadWithRetry(job.id, url, ctrl.signal).catch(async (err) => {
        // Some SoundCloud (and other) uploads are DRM-only. Don't touch the encryption — get the same song elsewhere.
        if (!/DRM protected/i.test((err as Error).message)) throw err;
        return downloadSameSongElsewhere(job.id, source, sourceId, ctrl.signal, err as Error);
      });
      if (key) inFlight.set(key, download);
      try {
        trackId = await download;
      } finally {
        if (key) inFlight.delete(key);
      }
    }
    throwIfCanceled(ctrl.signal);
    // Re-read: the playlist may have been deleted while this song was downloading.
    const playlistId = getJob(job.id)?.playlist_id;
    if (playlistId && db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(playlistId)) addToPlaylist(playlistId, trackId, job.position);
    updateJob(job.id, { status: 'done', progress: 100, track_id: trackId });
  } catch (err) {
    const canceled = ctrl.signal.aborted;
    updateJob(job.id, { status: canceled ? 'canceled' : 'error', error: canceled ? null : (err as Error).message });
  } finally {
    running.delete(job.id);
    setImmediate(pump);
  }
}

/** Which account each running job belongs to (for fair scheduling). */
const runningOwner = new Map<number, number>();

/**
 * Starts queued downloads up to the concurrency limit. Accounts take turns: the next job comes from
 * the account with the fewest downloads running, so one big import can't block everyone else.
 */
function pump() {
  while (running.size < config.concurrency) {
    const candidates = db
      .prepare(`SELECT user_id, MIN(id) AS id FROM jobs WHERE status = 'queued' AND user_id IS NOT NULL GROUP BY user_id`)
      .all() as { user_id: number; id: number }[];
    if (!candidates.length) return;
    const busy = (uid: number) => [...runningOwner.values()].filter((u) => u === uid).length;
    candidates.sort((a, b) => busy(a.user_id) - busy(b.user_id) || a.id - b.id);
    const next = getJob(candidates[0].id);
    if (!next) return;
    // Mark synchronously so the next loop iteration picks a different job.
    db.prepare(`UPDATE jobs SET status = 'running' WHERE id = ?`).run(next.id);
    runningOwner.set(next.id, next.user_id!);
    void runJob(next).finally(() => runningOwner.delete(next.id));
  }
}

export function startQueue() {
  // Older jobs were given their playlist's cover; drop it so each song shows its own artwork.
  db.prepare(
    `UPDATE jobs SET thumbnail = NULL WHERE query IS NOT NULL AND playlist_id IS NOT NULL
     AND thumbnail IS NOT NULL AND thumbnail = (SELECT cover_url FROM playlists WHERE id = jobs.playlist_id)`,
  ).run();
  pump();
}

export function listJobs(userId: number, limit = 500) {
  // A finished download whose song was deleted keeps its row (so a playlist sync doesn't fetch the song again) but isn't listed.
  const rows = db
    .prepare(
      `SELECT * FROM jobs WHERE user_id = ? AND NOT (status = 'done' AND track_id IS NULL)
       ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'error' THEN 2 ELSE 3 END, id DESC LIMIT ?`,
    )
    .all(userId, limit) as JobRow[];
  return rows.map(serializeJob);
}

/** Cancels a job (only the account's own jobs when userId is given). */
export function cancelJob(id: number, userId?: number) {
  const job = getJob(id);
  if (!job || (userId !== undefined && job.user_id !== userId)) return;
  const ctrl = running.get(id);
  if (ctrl) ctrl.abort();
  else if (job.status === 'queued') updateJob(id, { status: 'canceled' });
}

export function retryJob(id: number, userId: number) {
  const job = getJob(id);
  if (!job || job.user_id !== userId || job.status === 'running' || job.status === 'queued') return;
  updateJob(id, { status: 'queued', progress: 0, error: null });
  setImmediate(pump);
}

export function retryFailed(userId: number) {
  db.prepare(`UPDATE jobs SET status = 'queued', progress = 0, error = NULL WHERE user_id = ? AND status IN ('error','canceled')`).run(userId);
  emit(userId, { type: 'jobs-cleared' });
  setImmediate(pump);
}

/** Stops everything queued or running for a playlist (used when the playlist is deleted). */
export function cancelPlaylistJobs(playlistId: number) {
  const ids = db.prepare(`SELECT id FROM jobs WHERE playlist_id = ? AND status IN ('queued','running')`).all(playlistId) as { id: number }[];
  for (const { id } of ids) cancelJob(id);
}

/** Cancels all of an account's queued and running downloads. */
export function cancelAll(userId: number) {
  db.prepare(`UPDATE jobs SET status = 'canceled' WHERE user_id = ? AND status = 'queued'`).run(userId);
  for (const [jobId, owner] of runningOwner) if (owner === userId) running.get(jobId)?.abort();
  emit(userId, { type: 'jobs-cleared' });
}

export function clearFinished(userId: number) {
  db.prepare(`DELETE FROM jobs WHERE user_id = ? AND status IN ('done','canceled','error')`).run(userId);
  emit(userId, { type: 'jobs-cleared' });
}

export function jobStats(userId: number) {
  return db.prepare(`SELECT status, COUNT(*) AS n FROM jobs WHERE user_id = ? GROUP BY status`).all(userId) as { status: string; n: number }[];
}
