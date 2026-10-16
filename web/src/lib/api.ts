export interface Track {
  id: number;
  source: string;
  sourceId: string;
  sourceUrl: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  cover: string | null;
  liked: boolean;
  playCount: number;
  lastPlayedAt: number | null;
  addedAt: number;
}

export interface PlaylistSummary {
  id: number;
  name: string;
  description: string | null;
  cover: string | null;
  covers: string[];
  sourceUrl: string | null;
  createdAt: number;
  updatedAt: number;
  count: number;
  duration: number;
  pending: number;
}

export interface Playlist extends PlaylistSummary {
  tracks: Track[];
}

export interface Job {
  id: number;
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled';
  url: string | null;
  query: string | null;
  source: string | null;
  title: string | null;
  artist: string | null;
  thumbnail: string | null;
  playlistId: number | null;
  trackId: number | null;
  progress: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export type SearchSource = 'ytmusic' | 'youtube' | 'soundcloud' | 'library';

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
  trackId?: number | null;
}

export interface ImportResult {
  kind: 'track' | 'playlist';
  name: string;
  playlistId: number | null;
  queued: number;
  existing: number;
  trackId?: number | null;
}

export interface Album {
  album: string;
  artist: string;
  count: number;
  cover: string;
}

export interface Artist {
  artist: string;
  count: number;
  cover: string;
}

export interface Home {
  recentlyAdded: Track[];
  recentlyPlayed: Track[];
  mostPlayed: Track[];
  stats: { tracks: number; seconds: number; artists: number };
}

export interface Settings {
  theme: unknown;
  /** Only sent to the admin. */
  spotify: { clientId: string; hasSecret: boolean } | null;
  hasCookies: boolean;
}

export interface DownloadSettings {
  quality: 'saver' | 'balanced' | 'best';
  maxMinutes: number;
  minFreeGb: number;
}

export interface SystemInfo {
  ytdlp: string;
  librarySize: number;
  disk: { free: number; total: number } | null;
  downloads: DownloadSettings;
  tracks: number;
  seconds: number;
}

export interface User {
  id: number;
  name: string;
  quotaBytes: number;
  isAdmin: boolean;
}

export interface AdminUser extends User {
  usedBytes: number;
  songs: number;
  createdAt: number;
  lastSeen: number | null;
}

/** Fired when the server says the session is gone, so the app can show the login screen. */
export const AUTH_LOST = 'tuno:auth-lost';

export interface DeleteResult {
  deleted: number;
  freed: number;
}

export interface StorageInfo {
  tracks: (Track & { size: number })[];
  totalSize: number;
  quota: number;
  disk: { free: number; total: number } | null;
  playlists: number;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event(AUTH_LOST));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const get = <T,>(url: string) => request<T>('GET', url);
const qs = (o: Record<string, string | number | undefined | null>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '') as [string, string][]).toString();

export const api = {
  me: () => get<{ user: User; used: number }>('/api/auth/me'),
  login: (password: string) => request<{ user: User }>('POST', '/api/auth/login', { password }),
  logout: () => request('POST', '/api/auth/logout', {}),

  users: () => get<AdminUser[]>('/api/admin/users'),
  createUser: (u: { name: string; password: string; quotaGb: number; isAdmin: boolean }) => request<User>('POST', '/api/admin/users', u),
  updateUser: (id: number, u: { name?: string; password?: string; quotaGb?: number; isAdmin?: boolean }) =>
    request<User>('PATCH', `/api/admin/users/${id}`, u),
  deleteUser: (id: number) => request<{ freed: number }>('DELETE', `/api/admin/users/${id}`),

  home: () => get<Home>('/api/home'),
  tracks: (p: { sort?: string; liked?: boolean; q?: string; artist?: string; album?: string } = {}) =>
    get<Track[]>(`/api/tracks?${qs({ sort: p.sort, liked: p.liked ? '1' : undefined, q: p.q, artist: p.artist, album: p.album })}`),
  track: (id: number) => get<Track>(`/api/tracks/${id}`),
  albums: () => get<Album[]>('/api/albums'),
  artists: () => get<Artist[]>('/api/artists'),
  updateTrack: (id: number, patch: Partial<Pick<Track, 'title' | 'artist' | 'album' | 'liked'>> & { cover?: string }) =>
    request<Track>('PATCH', `/api/tracks/${id}`, patch),
  deleteTrack: (id: number) => request<DeleteResult>('DELETE', `/api/tracks/${id}`),
  deleteTracks: (trackIds: number[]) => request<DeleteResult>('POST', '/api/tracks/delete', { trackIds }),
  clearLibrary: (opts: { deletePlaylists: boolean; clearHistory: boolean }) =>
    request<DeleteResult>('POST', '/api/library/clear', { confirm: 'DELETE', ...opts }),
  storage: () => get<StorageInfo>('/api/storage'),
  markPlayed: (id: number) => request('POST', `/api/tracks/${id}/play`, {}),

  playlists: () => get<PlaylistSummary[]>('/api/playlists'),
  playlist: (id: number) => get<Playlist>(`/api/playlists/${id}`),
  createPlaylist: (name: string, trackIds: number[] = []) => request<PlaylistSummary>('POST', '/api/playlists', { name, trackIds }),
  updatePlaylist: (id: number, patch: { name?: string; description?: string | null; cover?: string | null }) =>
    request<PlaylistSummary>('PATCH', `/api/playlists/${id}`, patch),
  deletePlaylist: (id: number, deleteTracks: boolean) => request('DELETE', `/api/playlists/${id}?deleteTracks=${deleteTracks ? 1 : 0}`),
  deleteOtherSongs: (id: number) => request<DeleteResult & { trackIds: number[] }>('POST', `/api/playlists/${id}/delete-others`, {}),
  addToPlaylist: (id: number, trackIds: number[]) => request('POST', `/api/playlists/${id}/tracks`, { trackIds }),
  removeFromPlaylist: (id: number, trackId: number) => request('DELETE', `/api/playlists/${id}/tracks/${trackId}`),
  reorderPlaylist: (id: number, trackIds: number[]) => request('PUT', `/api/playlists/${id}/order`, { trackIds }),
  syncPlaylist: (id: number) => request<ImportResult>('POST', `/api/playlists/${id}/sync`, {}),

  importUrl: (url: string, playlistId?: number) => request<ImportResult>('POST', '/api/import', { url, playlistId }),
  jobs: () => get<{ jobs: Job[]; stats: { status: string; n: number }[] }>('/api/jobs'),
  cancelJob: (id: number) => request('POST', `/api/jobs/${id}/cancel`, {}),
  retryJob: (id: number) => request('POST', `/api/jobs/${id}/retry`, {}),
  retryFailed: () => request('POST', '/api/jobs/retry-failed', {}),
  cancelAll: () => request('POST', '/api/jobs/cancel-all', {}),
  clearFinished: () => request('DELETE', '/api/jobs/finished'),

  warmPreview: (url: string) => request('POST', '/api/preview/warm', { url }).catch(() => {}),
  search: (q: string, source: SearchSource) => get<SearchResult[]>(`/api/search?${qs({ q, source })}`),

  settings: () => get<Settings>('/api/settings'),
  saveTheme: (theme: unknown) => request('PUT', '/api/settings/theme', theme),
  saveSpotify: (clientId: string, clientSecret: string) => request('PUT', '/api/settings/spotify', { clientId, clientSecret }),
  saveCookies: (text: string) => request('PUT', '/api/settings/cookies', { text }),
  deleteCookies: () => request('DELETE', '/api/settings/cookies'),
  system: () => get<SystemInfo>('/api/system'),
  saveDownloadSettings: (patch: Partial<DownloadSettings>) => request<DownloadSettings>('PUT', '/api/settings/downloads', patch),
  updateYtdlp: () => request<{ version: string }>('POST', '/api/system/update-ytdlp', {}),
};

export const streamUrl = (t: Track) => `/api/stream/${t.id}`;
export const previewUrl = (url: string) => `/api/preview?${qs({ url })}`;
