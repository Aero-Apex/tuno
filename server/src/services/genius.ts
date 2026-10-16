/**
 * Genius lyrics pages (genius.com/Artist-song-title-lyrics) answer 403 to anything but a real browser, so yt-dlp can never
 * read them. The link itself still names the song, which is enough to find it on YouTube Music, YouTube or SoundCloud.
 */

export function isGeniusUrl(url: string): boolean {
  try {
    return /(^|\.)genius\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** The words of a lyrics link ("Alximo-paparazzi-dubstep-lyrics" -> ["Alximo", "paparazzi", "dubstep"]), or null for other Genius pages. */
export function geniusSongWords(url: string): string[] | null {
  if (!isGeniusUrl(url)) return null;
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  const m = path.match(/^\/([^/]+?)-lyrics\/?$/i);
  if (!m) return null;
  const words = m[1].split(/[-_\s]+/).filter(Boolean);
  return words.length ? words : null;
}

export const titleCase = (words: string[]) => words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
