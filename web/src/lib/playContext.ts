import { useQuery } from '@tanstack/react-query';
import { usePlayer } from '../store/player';
import { api } from './api';

/** Name of (and link to) where the queue came from, e.g. the playlist it was started from. */
export function useContextName(): { name: string; to?: string } {
  const context = usePlayer((s) => s.context);
  const { data: playlists } = useQuery({ queryKey: ['playlists'], queryFn: api.playlists, enabled: !!context?.startsWith('playlist:') });
  if (!context) return { name: 'Now playing' };
  if (context === 'liked') return { name: 'Liked Songs', to: '/liked' };
  if (context === 'library') return { name: 'Your Library', to: '/library' };
  if (context === 'home:played') return { name: 'Jump back in', to: '/' };
  if (context === 'home:added') return { name: 'Recently added', to: '/' };
  if (context === 'home:top') return { name: 'On repeat', to: '/' };
  const [kind, ...rest] = context.split(':');
  const value = rest.join(':');
  if (kind === 'playlist') return { name: playlists?.find((p) => p.id === Number(value))?.name ?? 'Playlist', to: `/playlist/${value}` };
  if (kind === 'album') return { name: value, to: `/album/${encodeURIComponent(value)}` };
  if (kind === 'artist') return { name: value, to: `/artist/${encodeURIComponent(value)}` };
  return { name: 'Now playing' };
}
