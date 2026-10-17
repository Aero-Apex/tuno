import { getSetting } from '../db.js';

/** Spotify audio can't be downloaded, so we only read metadata and match each song on YouTube Music. */

export interface SpotifyTrack {
  title: string;
  artist: string;
  album?: string | null;
  durationSec?: number | null;
  /** The song's own artwork (its album cover), when Spotify gives one. */
  cover?: string | null;
}

export interface SpotifyCollection {
  kind: 'track' | 'album' | 'playlist' | 'artist';
  name: string;
  cover?: string | null;
  tracks: SpotifyTrack[];
}

export interface SpotifyCreds {
  clientId?: string;
  clientSecret?: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export function isSpotifyUrl(url: string): boolean {
  return /(^spotify:|open\.spotify\.com\/|spotify\.link\/)/i.test(url);
}

async function parse(url: string): Promise<{ type: SpotifyCollection['kind']; id: string }> {
  if (/spotify\.link\//i.test(url)) {
    // Short links redirect to the real open.spotify.com URL.
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA } });
    url = res.url;
  }
  const m =
    url.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|artist)\/([A-Za-z0-9]+)/i) ??
    url.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)/i);
  if (!m) throw new Error('Unsupported Spotify link. Use a track, album, playlist or artist link.');
  return { type: m[1].toLowerCase() as SpotifyCollection['kind'], id: m[2] };
}

async function fromEmbed(type: string, id: string): Promise<SpotifyCollection> {
  const res = await fetch(`https://open.spotify.com/embed/${type}/${id}`, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`Spotify returned ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Could not read Spotify page');
  const entity = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
  if (!entity) throw new Error('Spotify item not found');
  const cover =
    entity.visualIdentity?.image?.sort?.((a: any, b: any) => (b.maxWidth ?? 0) - (a.maxWidth ?? 0))?.[0]?.url ??
    entity.coverArt?.sources?.at?.(-1)?.url ??
    null;

  if (type === 'track') {
    return {
      kind: 'track',
      name: entity.name ?? entity.title,
      cover,
      tracks: [
        {
          title: entity.name ?? entity.title,
          artist: (entity.artists ?? []).map((a: any) => a.name).join(', ') || 'Unknown artist',
          durationSec: entity.duration ? entity.duration / 1000 : null,
        },
      ],
    };
  }
  const tracks: SpotifyTrack[] = (entity.trackList ?? []).map((t: any) => ({
    title: t.title,
    artist: t.subtitle || 'Unknown artist',
    album: type === 'album' ? entity.name : null,
    durationSec: t.duration ? t.duration / 1000 : null,
  }));
  return { kind: type as SpotifyCollection['kind'], name: entity.name ?? entity.title ?? 'Spotify', cover, tracks };
}

let token: { value: string; expires: number } | null = null;

async function apiToken(creds: SpotifyCreds): Promise<string> {
  if (token && token.expires > Date.now() + 30_000) return token.value;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify login failed (${res.status}). Check the Client ID and Secret in Settings.`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return token.value;
}

async function api<T>(creds: SpotifyCreds, url: string): Promise<T> {
  const res = await fetch(url.startsWith('http') ? url : `https://api.spotify.com/v1${url}`, {
    headers: { authorization: `Bearer ${await apiToken(creds)}` },
  });
  if (!res.ok) throw new Error(`Spotify API ${res.status}`);
  return (await res.json()) as T;
}

const mapApiTrack = (t: any, album?: string, cover?: string | null): SpotifyTrack => ({
  title: t.name,
  artist: (t.artists ?? []).map((a: any) => a.name).join(', ') || 'Unknown artist',
  album: album ?? t.album?.name ?? null,
  durationSec: t.duration_ms ? t.duration_ms / 1000 : null,
  cover: cover ?? t.album?.images?.[0]?.url ?? null,
});

/** Full playlists/albums through the Web API (no 100-track limit). Needs a free Spotify developer app. */
async function fromApi(type: string, id: string, creds: SpotifyCreds): Promise<SpotifyCollection> {
  if (type === 'track') {
    const t = await api<any>(creds, `/tracks/${id}`);
    return { kind: 'track', name: t.name, cover: t.album?.images?.[0]?.url, tracks: [mapApiTrack(t)] };
  }
  if (type === 'album') {
    const a = await api<any>(creds, `/albums/${id}`);
    const tracks: SpotifyTrack[] = a.tracks.items.map((t: any) => mapApiTrack(t, a.name, a.images?.[0]?.url));
    let next = a.tracks.next as string | null;
    while (next) {
      const page = await api<any>(creds, next);
      tracks.push(...page.items.map((t: any) => mapApiTrack(t, a.name, a.images?.[0]?.url)));
      next = page.next;
    }
    return { kind: 'album', name: a.name, cover: a.images?.[0]?.url, tracks };
  }
  if (type === 'playlist') {
    const p = await api<any>(creds, `/playlists/${id}?fields=name,images,tracks.next,tracks.items(track(name,duration_ms,artists(name),album(name,images)))`);
    const tracks: SpotifyTrack[] = p.tracks.items.filter((i: any) => i.track?.name).map((i: any) => mapApiTrack(i.track));
    let next = p.tracks.next as string | null;
    while (next) {
      const page = await api<any>(creds, next);
      tracks.push(...page.items.filter((i: any) => i.track?.name).map((i: any) => mapApiTrack(i.track)));
      next = page.next;
    }
    return { kind: 'playlist', name: p.name, cover: p.images?.[0]?.url, tracks };
  }
  const artist = await api<any>(creds, `/artists/${id}`);
  const top = await api<any>(creds, `/artists/${id}/top-tracks?market=US`);
  return { kind: 'artist', name: `${artist.name} — Top tracks`, cover: artist.images?.[0]?.url, tracks: top.tracks.map((t: any) => mapApiTrack(t)) };
}

/** Saved Spotify developer keys (Settings → Spotify, admin only). */
export function hasSpotifyKeys(): boolean {
  const creds = getSetting<SpotifyCreds>('spotify', {});
  return !!(creds.clientId && creds.clientSecret);
}

/**
 * Spotify downloads are an admin switch that only works once the developer keys are saved. A server that already
 * has keys starts with the switch on, so Spotify links keep working after an update; the admin can turn it off.
 */
export function spotifyDownloadsOn(): boolean {
  return getSetting<boolean>('spotifyDownloads', hasSpotifyKeys()) && hasSpotifyKeys();
}

export interface SpotifySearchHit {
  kind: 'track' | 'playlist';
  id: string;
  url: string;
  title: string;
  artist: string;
  album?: string | null;
  duration?: number | null;
  thumbnail?: string | null;
}

/** Tracks and playlists from Spotify's search. Needs the developer keys. */
export async function searchSpotify(q: string): Promise<SpotifySearchHit[]> {
  const creds = getSetting<SpotifyCreds>('spotify', {});
  if (!creds.clientId || !creds.clientSecret) throw new Error('Add your Spotify Client ID and Secret in Settings to search Spotify.');
  const data = await api<any>(creds, `/search?${new URLSearchParams({ q, type: 'track,playlist', limit: '10' })}`);
  const tracks: SpotifySearchHit[] = (data.tracks?.items ?? []).filter(Boolean).map((t: any) => ({
    kind: 'track',
    id: t.id,
    url: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
    title: t.name,
    artist: (t.artists ?? []).map((a: any) => a.name).join(', ') || 'Unknown artist',
    album: t.album?.name ?? null,
    duration: t.duration_ms ? t.duration_ms / 1000 : null,
    thumbnail: t.album?.images?.[0]?.url ?? null,
  }));
  const playlists: SpotifySearchHit[] = (data.playlists?.items ?? []).filter(Boolean).map((p: any) => ({
    kind: 'playlist',
    id: p.id,
    url: p.external_urls?.spotify ?? `https://open.spotify.com/playlist/${p.id}`,
    title: p.name,
    artist: p.owner?.display_name ?? 'Spotify',
    thumbnail: p.images?.[0]?.url ?? null,
  }));
  return [...tracks, ...playlists];
}

export async function resolveSpotify(url: string): Promise<SpotifyCollection> {
  const { type, id } = await parse(url);
  const creds = getSetting<SpotifyCreds>('spotify', {});
  if (creds.clientId && creds.clientSecret) {
    try {
      return await fromApi(type, id, creds);
    } catch {
      // Editorial playlists are blocked for API apps; the embed page still works for those.
    }
  }
  const result = await fromEmbed(type, id);
  if (result.kind === 'artist') result.name = `${result.name} — Top tracks`;
  return result;
}
