/** Sizes (px wide) the server can make a cover in. Anything bigger gets the original. */
const WIDTHS = [128, 256, 512];

/** The smallest server-made width that is still sharp when drawn `px` CSS pixels wide on a 2x screen. */
function widthFor(px?: number): number {
  return WIDTHS.find((w) => px !== undefined && w >= px * 2) ?? 512;
}

/**
 * Picture URL to put in an <img>. Covers from the server (and remote artwork, which goes through the server so its colors
 * can be read) are asked for at about the size they're shown, instead of downloading the full image for a 40 px thumbnail.
 */
export function img(url?: string | null, px?: number): string | null {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  const sized = (u: string) => `${u}${u.includes('?') ? '&' : '?'}w=${widthFor(px)}`;
  if (url.startsWith('/api/cover/') || url.startsWith('/api/files/covers/')) return sized(url);
  if (url.startsWith('/')) return url;
  return sized(`/api/img?url=${encodeURIComponent(url)}`);
}

/** Pixel width hinted by a Tailwind size class ("h-10 w-10" is 40 px), or undefined when the class gives none. */
export function sizeFromClass(className: string): number | undefined {
  const m = className.match(/(?:^|\s)(?:size|h|w)-(\d+(?:\.\d+)?)(?=\s|$)/);
  return m ? Number(m[1]) * 4 : undefined;
}
