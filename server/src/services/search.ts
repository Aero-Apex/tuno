import { Innertube, Log } from 'youtubei.js';
import { db } from '../db.js';
import { runYtdlp, ytdlpError, bestThumb, type FlatEntry } from './ytdlp.js';
import { cleanMeta, similarity, norm, stripTopic } from './metadata.js';
import { searchSoundCloudApi } from './soundcloud.js';
import { searchSpotify } from './spotify.js';

Log.setLevel(Log.Level.NONE);

export type SearchSource = 'youtube' | 'ytmusic' | 'soundcloud' | 'spotify' | 'library';

export interface SearchResult {
  key: string;
  source: SearchSource;
  kind: 'track' | 'album' | 'playlist';
  url: string;
  title: string;
  artist: string;
  album?: string | null;
  duration?: number | null;
  thumbnail?: string | null;
  /** Library track id when this result is already downloaded. */
  trackId?: number | null;
}

let innertube: Promise<Innertube> | null = null;
function yt(): Promise<Innertube> {
  innertube ??= Innertube.create({ retrieve_player: false }).catch((err) => {
    innertube = null;
    throw err;
  });
  return innertube;
}

const cache = new Map<string, { at: number; data: SearchResult[] }>();
const TTL = 5 * 60_000;

async function cached(key: string, fn: () => Promise<SearchResult[]>): Promise<SearchResult[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return data;
}

/** YT Music thumbnails come tiny; ask for a bigger square. */
function bigYtmThumb(url?: string): string | undefined {
  return url?.replace(/=w\d+-h\d+/, '=w544-h544');
}

async function searchYtMusic(q: string): Promise<SearchResult[]> {
  const client = await yt();
  const [songs, albums, playlists] = await Promise.all([
    client.music.search(q, { type: 'song' }),
    client.music.search(q, { type: 'album' }).catch(() => null),
    client.music.search(q, { type: 'playlist' }).catch(() => null),
  ]);
  const out: SearchResult[] = [];
  const songShelf = songs.contents?.find((c: any) => c.type === 'MusicShelf') as any;
  for (const it of songShelf?.contents ?? []) {
    if (!it.id) continue;
    out.push({
      key: `ytm:${it.id}`,
      source: 'ytmusic',
      kind: 'track',
      url: `https://music.youtube.com/watch?v=${it.id}`,
      title: it.title ?? 'Untitled',
      artist: it.artists?.map((a: any) => a.name).join(', ') || it.author?.name || 'Unknown artist',
      album: it.album?.name ?? null,
      duration: it.duration?.seconds ?? null,
      thumbnail: bigYtmThumb(it.thumbnail?.contents?.[0]?.url),
    });
  }
  const albumShelf = albums?.contents?.find((c: any) => c.type === 'MusicShelf') as any;
  for (const it of (albumShelf?.contents ?? []).slice(0, 8)) {
    if (!it.id) continue;
    out.push({
      key: `ytm-album:${it.id}`,
      source: 'ytmusic',
      kind: 'album',
      url: `https://music.youtube.com/browse/${it.id}`,
      title: it.title ?? 'Untitled album',
      artist: it.author?.name || it.artists?.map((a: any) => a.name).join(', ') || 'Unknown artist',
      album: it.year ?? null,
      thumbnail: bigYtmThumb(it.thumbnail?.contents?.[0]?.url),
    });
  }
  const playlistShelf = playlists?.contents?.find((c: any) => c.type === 'MusicShelf') as any;
  for (const it of (playlistShelf?.contents ?? []).slice(0, 8)) {
    if (!it.id) continue;
    const listId = String(it.id).replace(/^VL/, '');
    out.push({
      key: `ytm-playlist:${listId}`,
      source: 'ytmusic',
      kind: 'playlist',
      url: `https://music.youtube.com/playlist?list=${listId}`,
      title: it.title ?? 'Untitled playlist',
      artist: it.author?.name || 'YouTube Music',
      thumbnail: bigYtmThumb(it.thumbnail?.contents?.[0]?.url),
    });
  }
  return out;
}

async function searchYouTube(q: string): Promise<SearchResult[]> {
  const client = await yt();
  const res = await client.search(q, { type: 'video' });
  return (res.videos as any[])
    .filter((v) => v.type === 'Video' && (v.id || v.video_id))
    .map((v) => {
      const id = v.id ?? v.video_id;
      const meta = cleanMeta({ title: v.title?.toString(), uploader: v.author?.name });
      return {
        key: `yt:${id}`,
        source: 'youtube' as const,
        kind: 'track' as const,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: meta.title,
        artist: meta.artist,
        duration: v.duration?.seconds ?? null,
        thumbnail: v.thumbnails?.[0]?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      };
    });
}

async function searchSoundCloud(q: string): Promise<SearchResult[]> {
  try {
    const tracks = await searchSoundCloudApi(q);
    return tracks.map((t) => {
      const meta = cleanMeta({ title: t.title, artist: t.artist !== t.uploader ? t.artist : undefined, uploader: t.uploader });
      return {
        key: `sc:${t.id}`,
        source: 'soundcloud' as const,
        kind: 'track' as const,
        url: t.url,
        title: meta.title,
        artist: meta.artist,
        duration: t.duration || null,
        thumbnail: t.artwork,
      };
    });
  } catch {
    return searchSoundCloudYtdlp(q);
  }
}

/** Slow fallback if SoundCloud's web API changes. */
async function searchSoundCloudYtdlp(q: string): Promise<SearchResult[]> {
  const res = await runYtdlp(['-J', '--flat-playlist', '--no-warnings', `scsearch20:${q}`], { timeoutMs: 45_000 });
  if (res.code !== 0) throw new Error(ytdlpError(res.stderr));
  const data = JSON.parse(res.stdout) as { entries?: (FlatEntry & { track?: string })[] };
  return (data.entries ?? [])
    .filter((e) => e?.id)
    .map((e) => {
      const meta = cleanMeta({ title: e.title, track: e.track, artists: e.artists, uploader: e.uploader });
      return {
        key: `sc:${e.id}`,
        source: 'soundcloud' as const,
        kind: 'track' as const,
        url: e.webpage_url ?? e.url ?? '',
        title: meta.title,
        artist: meta.artist,
        duration: e.duration ?? null,
        thumbnail: bestThumb(e.thumbnails)?.replace('-original.', '-t500x500.') ?? null,
      };
    });
}

/** Spotify's tracks and playlists. Tracks can't be streamed, so they're only ever downloaded (and only when downloads are on). */
async function searchSpotifyResults(q: string): Promise<SearchResult[]> {
  const hits = await searchSpotify(q);
  return hits.map((h) => ({
    key: `sp${h.kind === 'playlist' ? '-pl' : ''}:${h.id}`,
    source: 'spotify' as const,
    kind: h.kind,
    url: h.url,
    title: h.title,
    artist: h.artist,
    album: h.album ?? null,
    duration: h.duration ?? null,
    thumbnail: h.thumbnail ?? null,
  }));
}

/** Playlists in this account's library whose name matches. Clicking one opens it instead of downloading. */
function searchLibraryPlaylists(q: string, userId: number): SearchResult[] {
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.cover_url, COUNT(pt.track_id) AS songs FROM playlists p
       LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
       WHERE p.user_id = ? AND p.name LIKE ? GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 30`,
    )
    .all(userId, like) as { id: number; name: string; cover_url: string | null; songs: number }[];
  return rows.map((p) => ({
    key: `libpl:${p.id}`,
    source: 'library' as const,
    kind: 'playlist' as const,
    url: `/playlist/${p.id}`,
    title: p.name,
    artist: `${p.songs} ${p.songs === 1 ? 'song' : 'songs'}`,
    thumbnail: p.cover_url,
  }));
}

function searchLibrary(q: string, userId: number): SearchResult[] {
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = db
    .prepare(
      `SELECT * FROM tracks WHERE user_id = ? AND (title LIKE ? OR artist LIKE ? OR album LIKE ?) ORDER BY play_count DESC, added_at DESC LIMIT 50`,
    )
    .all(userId, like, like, like) as any[];
  return rows.map((t) => ({
    key: `lib:${t.id}`,
    source: 'library' as const,
    kind: 'track' as const,
    url: t.source_url,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    thumbnail: t.cover_path ? `/api/cover/${t.id}?v=${t.added_at}` : null,
    trackId: t.id,
  }));
}

/** Marks results that are already in this account's library. */
function markOwned(results: SearchResult[], userId: number): SearchResult[] {
  const stmt = db.prepare('SELECT id FROM tracks WHERE user_id = ? AND source = ? AND source_id = ?');
  return results.map((r) => {
    if (r.kind !== 'track' || r.source === 'library') return r;
    const id = r.key.split(':')[1];
    const src = r.source === 'soundcloud' ? 'soundcloud' : 'youtube';
    const row = stmt.get(userId, src, id) as { id: number } | undefined;
    return { ...r, trackId: row?.id ?? null };
  });
}

/** Searches a source. With a userId, results already in that account's library are marked (and 'library' searches it). */
export async function search(q: string, source: SearchSource, userId?: number): Promise<SearchResult[]> {
  q = q.trim();
  if (!q) return [];
  if (source === 'library') return userId ? [...searchLibrary(q, userId), ...searchLibraryPlaylists(q, userId)] : [];
  const fn =
    source === 'ytmusic' ? searchYtMusic : source === 'youtube' ? searchYouTube : source === 'spotify' ? searchSpotifyResults : searchSoundCloud;
  const results = await cached(`${source}:${q.toLowerCase()}`, async () => {
    try {
      return await fn(q);
    } catch (err) {
      if (source === 'soundcloud' || source === 'spotify') throw err;
      // The YouTube client's session can go stale on a long-running server; start a fresh one and retry once.
      innertube = null;
      return fn(q);
    }
  });
  return userId ? markOwned(results, userId) : results;
}

/** Words that mark a different version of a song; a match should agree on these. */
const VERSION_TAGS = ['slowed', 'reverb', 'sped', 'nightcore', 'remix', 'live', 'acoustic', 'instrumental', 'karaoke', 'cover', '8d', 'boosted', 'phonk'];
const FILLER = new Set([...VERSION_TAGS, 'up', 'ultra', 'super', 'bass', 'edit', 'version', 'mix', 'radio', 'extended', 'remaster', 'remastered', 'official', 'audio', 'video', 'lyrics', 'feat', 'ft', 'prod']);

const tokens = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9Ѐ-ӿ぀-ヿ一-鿿]+/).filter(Boolean);
const coreTokens = (s: string) => tokens(s.replace(/\b(feat|ft)\.?\s.*$/i, '')).filter((t) => !FILLER.has(t));
const tags = (s: string) => new Set(tokens(s).filter((t) => VERSION_TAGS.includes(t)));

/** Strips "- Slowed", "(feat. X)", "[Remix]" etc. to get the bare song name. */
export function coreTitle(title: string): string {
  return title
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/\s+[-–—]\s+(slowed|sped up|reverb|nightcore|remix|live|acoustic|instrumental|remaster(ed)?|radio edit|extended).*$/i, '')
    .trim();
}

export interface SongMatch {
  url: string;
  id: string;
  source: 'youtube' | 'soundcloud';
  title: string;
  thumbnail?: string | null;
  score: number;
}

/** 0–1 confidence that a search result is the song described by Spotify-style metadata. */
export function scoreMatch(want: { title: string; artist: string; duration?: number | null }, r: SearchResult): number {
  const wantCore = coreTokens(want.title);
  const haveText = `${r.title} ${r.artist}`;
  const have = new Set(tokens(haveText));
  const coverage = wantCore.length ? wantCore.filter((t) => have.has(t)).length / wantCore.length : 0;
  const title = 0.7 * coverage + 0.3 * similarity(want.title, r.title);

  const artists = want.artist.split(/,|&| x /i).map((a) => norm(a)).filter(Boolean);
  const haveArtist = norm(`${stripTopic(r.artist)} ${r.title}`);
  const artist = artists.some((a) => haveArtist.includes(a)) ? 1 : similarity(want.artist, r.artist);

  let duration = 0.5;
  if (want.duration && r.duration) {
    const diff = Math.abs(want.duration - r.duration);
    duration = diff <= 3 ? 1 : Math.max(0, 1 - (diff - 3) / 20);
  }

  // "Slowed" should match "Slowed", not the original (and vice versa).
  const a = tags(want.title);
  const b = tags(haveText);
  let penalty = 0;
  for (const t of a) if (!b.has(t)) penalty += 0.1;
  for (const t of b) if (!a.has(t)) penalty += 0.1;

  const bonus = r.source === 'ytmusic' ? 0.03 : 0;
  return title * 0.4 + artist * 0.3 + duration * 0.3 - Math.min(0.3, penalty) + bonus;
}

const ACCEPT = 0.6;
const CONFIDENT = 0.82;

/**
 * Finds a downloadable upload for a song known only by metadata (used for Spotify, whose audio is DRM-protected).
 * Tries YT Music first; if that isn't a confident match, searches YT Music, YouTube and SoundCloud
 * with a few query variants and takes the best-scoring result.
 */
export async function matchSong(
  title: string,
  artist: string,
  durationSec?: number | null,
  opts: { skipSoundCloud?: boolean } = {},
): Promise<SongMatch | null> {
  const want = { title, artist, duration: durationSec };
  const mainArtist = artist.split(',')[0].trim();
  const core = coreTitle(title);
  const queries = [...new Set([`${mainArtist} ${title}`, `${mainArtist} ${core}`, title])];

  const toMatch = (r: SearchResult, score: number): SongMatch => ({
    url: r.url,
    id: r.key.split(':')[1],
    source: r.source === 'soundcloud' ? 'soundcloud' : 'youtube',
    title: `${r.artist} - ${r.title}`,
    thumbnail: r.thumbnail ?? null,
    score,
  });
  const best = (results: SearchResult[]) =>
    results
      .filter((r) => r.kind === 'track' && r.source !== 'library')
      .map((r) => ({ r, s: scoreMatch(want, r) }))
      .sort((x, y) => y.s - x.s)[0];

  const first = best(await search(queries[0], 'ytmusic').catch(() => []));
  if (first && first.s >= CONFIDENT) return toMatch(first.r, first.s);

  const searches: Promise<SearchResult[]>[] = [];
  for (const q of queries) {
    for (const source of ['ytmusic', 'youtube', 'soundcloud'] as const) {
      if (q === queries[0] && source === 'ytmusic') continue;
      if (source === 'soundcloud' && opts.skipSoundCloud) continue;
      searches.push(search(q, source).catch(() => []));
    }
  }
  const all = (await Promise.all(searches)).flat();
  const top = best(first ? [first.r, ...all] : all);
  return top && top.s >= ACCEPT ? toMatch(top.r, top.s) : null;
}

/**
 * Finds a song when all we have is the words of its name, with no way to tell artist from title
 * (the "Alximo-paparazzi-dubstep" of a Genius link). The best result contains every word and as few extras as possible.
 */
export async function matchWords(words: string[]): Promise<SongMatch | null> {
  const query = words.join(' ');
  const want = [...new Set(tokens(query))];
  if (!want.length) return null;
  const wantTags = tags(query);
  const lists = await Promise.all((['ytmusic', 'youtube', 'soundcloud'] as const).map((src) => search(query, src).catch(() => [] as SearchResult[])));

  let best: { r: SearchResult; s: number } | undefined;
  for (const r of lists.flat()) {
    if (r.kind !== 'track' || r.source === 'library') continue;
    const have = tokens(`${r.title} ${r.artist}`);
    const haveSet = new Set(have);
    const coverage = want.filter((t) => haveSet.has(t)).length / want.length;
    if (coverage < 0.8) continue;
    const extras = have.filter((t) => !want.includes(t) && !FILLER.has(t)).length;
    let penalty = 0;
    for (const t of tags(r.title)) if (!wantTags.has(t)) penalty += 0.15; // "slowed", "cover"... unless the link says so
    const s = coverage - Math.min(0.3, extras * 0.03) - Math.min(0.3, penalty) + (r.source === 'ytmusic' ? 0.05 : 0);
    if (!best || s > best.s) best = { r, s };
  }
  if (!best || best.s < 0.6) return null;
  const r = best.r;
  return {
    url: r.url,
    id: r.key.split(':')[1],
    source: r.source === 'soundcloud' ? 'soundcloud' : 'youtube',
    title: `${r.artist} - ${r.title}`,
    thumbnail: r.thumbnail ?? null,
    score: best.s,
  };
}
