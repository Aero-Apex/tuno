/**
 * Fast SoundCloud search through the same public api-v2 the soundcloud.com website uses
 * (~0.5 s instead of ~8 s for spawning yt-dlp). The website's client_id is read from its
 * JS bundle and cached; it's refreshed automatically when SoundCloud rotates it.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

let clientId: Promise<string> | null = null;

async function fetchClientId(): Promise<string> {
  const html = await (await fetch('https://soundcloud.com/', { headers: { 'user-agent': UA } })).text();
  const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  // The id usually lives in one of the last bundles.
  for (const src of scripts.reverse()) {
    const js = await (await fetch(src, { headers: { 'user-agent': UA } })).text();
    const m = js.match(/client_id\s*:\s*"([0-9a-zA-Z]{32})"/);
    if (m) return m[1];
  }
  throw new Error('Could not find SoundCloud client id');
}

function getClientId(fresh = false): Promise<string> {
  if (fresh || !clientId) {
    clientId = fetchClientId().catch((err) => {
      clientId = null;
      throw err;
    });
  }
  return clientId;
}

export interface ScTrack {
  id: number;
  title: string;
  artist: string;
  uploader: string;
  duration: number;
  url: string;
  artwork: string | null;
}

/** Title/artist/length of one track by id, e.g. to find a DRM-protected song elsewhere. */
export async function getSoundCloudTrack(id: string): Promise<ScTrack | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cid = await getClientId(attempt > 0);
    const res = await fetch(`https://api-v2.soundcloud.com/tracks/${encodeURIComponent(id)}?client_id=${cid}`, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) continue;
    if (!res.ok) return null;
    const t = (await res.json()) as any;
    return {
      id: t.id,
      title: t.title,
      artist: t.publisher_metadata?.artist || t.user?.username || 'Unknown artist',
      uploader: t.user?.username ?? '',
      duration: (t.full_duration ?? t.duration ?? 0) / 1000,
      url: t.permalink_url,
      artwork: (t.artwork_url ?? null)?.replace('-large.', '-t500x500.') ?? null,
    };
  }
  return null;
}

export async function searchSoundCloudApi(q: string, limit = 20): Promise<ScTrack[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = await getClientId(attempt > 0);
    const res = await fetch(
      `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&limit=${limit}&client_id=${id}`,
      { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10_000) },
    );
    if (res.status === 401 || res.status === 403) continue; // client id rotated
    if (!res.ok) throw new Error(`SoundCloud returned ${res.status}`);
    const data = (await res.json()) as { collection: any[] };
    return data.collection
      .filter((t) => t.kind === 'track' && t.permalink_url)
      .map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.publisher_metadata?.artist || t.user?.username || 'Unknown artist',
        uploader: t.user?.username ?? '',
        duration: (t.full_duration ?? t.duration ?? 0) / 1000,
        url: t.permalink_url,
        artwork: (t.artwork_url ?? t.user?.avatar_url ?? null)?.replace('-large.', '-t500x500.') ?? null,
      }));
  }
  throw new Error('SoundCloud rejected the request');
}
