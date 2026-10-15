export function fmtTime(sec?: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '--:--';
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtLong(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h) return `${h} hr ${m} min`;
  return `${m} min`;
}

export function fmtBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function fmtAgo(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

export const SOURCE_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  ytmusic: 'YT Music',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  bandcamp: 'Bandcamp',
  library: 'Library',
};

export const SOURCE_COLOR: Record<string, string> = {
  youtube: '#ff0033',
  ytmusic: '#ff0033',
  soundcloud: '#ff5500',
  spotify: '#1ed760',
  bandcamp: '#1da0c3',
  library: 'rgb(var(--c-accent))',
};

export function isUrl(s: string) {
  return /^(https?:\/\/|spotify:)\S+$/i.test(s.trim());
}
