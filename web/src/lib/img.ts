/** Remote images go through the server so we can read their colors and they keep working offline-ish via cache. */
export function img(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('/') || url.startsWith('data:')) return url;
  return `/api/img?url=${encodeURIComponent(url)}`;
}
