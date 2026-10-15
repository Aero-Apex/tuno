/** Turns messy upload titles ("Artist - Song (Official Video) [HD]") into clean title/artist pairs. */

const NOISE =
  /\s*[([](official\s*(music\s*)?(video|audio|lyric(s)?\s*video|visualizer)|lyrics?|lyric video|audio|hd|hq|4k|mv|m\/v|visualizer|explicit|clean|free download|out now)[)\]]\s*/gi;

export function stripNoise(s: string): string {
  return s.replace(NOISE, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function stripTopic(s: string): string {
  return s.replace(/\s*-\s*Topic$/i, '').trim();
}

export interface RawMeta {
  title?: string;
  track?: string;
  artist?: string;
  artists?: string[];
  creator?: string;
  uploader?: string;
  channel?: string;
}

export function cleanMeta(raw: RawMeta): { title: string; artist: string } {
  const declaredArtist = raw.artists?.length ? raw.artists.join(', ') : raw.artist || raw.creator;
  const uploader = stripTopic(raw.uploader || raw.channel || '');
  let title = stripNoise(raw.track || raw.title || 'Untitled');
  let artist = declaredArtist ? stripTopic(declaredArtist) : '';

  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) {
    const [, left, right] = dash;
    const main = (artist || uploader).toLowerCase();
    if (main && right.toLowerCase() === main) {
      title = left;
      artist ||= right;
    } else if (main && left.toLowerCase() === main) {
      title = right;
      artist ||= left;
    } else if (!declaredArtist) {
      // "Artist - Title" is the common convention for uploads without music metadata.
      artist = left;
      title = right;
    }
  }

  return { title: stripNoise(title) || 'Untitled', artist: artist || uploader || 'Unknown artist' };
}

/** Normalized string for fuzzy comparison. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/feat\.?|ft\.?|featuring/g, ' ')
    .replace(/[^a-z0-9Ѐ-ӿ぀-ヿ一-鿿]+/g, ' ')
    .trim();
}

/** Token overlap score between 0 and 1. */
export function similarity(a: string, b: string): number {
  const ta = new Set(norm(a).split(' ').filter(Boolean));
  const tb = new Set(norm(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.max(ta.size, tb.size);
}
