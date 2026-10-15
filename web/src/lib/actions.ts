import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type SearchResult, type Track } from './api';
import { useUI } from '../store/ui';
import { usePlayer } from '../store/player';
import { fmtBytes, plural } from './format';

/** Shared mutations used from many places (rows, menus, player bar). */
export function useActions() {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const navigate = useNavigate();

  const refresh = (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const actions = {
    async toggleLike(t: Track) {
      const updated = await api.updateTrack(t.id, { liked: !t.liked });
      usePlayer.getState().updateTrack(updated);
      refresh('tracks', 'playlist', 'home');
      toast(updated.liked ? 'Added to Liked Songs' : 'Removed from Liked Songs', 'success');
    },

    async importUrl(url: string, playlistId?: number | null) {
      try {
        const r = await api.importUrl(url, playlistId ?? undefined);
        refresh('jobs', 'playlists');
        if (r.kind === 'playlist') {
          toast(
            r.queued ? `Downloading ${plural(r.queued, 'song')} from “${r.name}”` : `“${r.name}” is already in your library`,
            'success',
            r.playlistId ? { label: 'Open', to: `/playlist/${r.playlistId}` } : undefined,
          );
        } else if (r.queued) toast(`Downloading “${r.name}”`, 'success', { label: 'Downloads', to: '/downloads' });
        else toast(`“${r.name}” is already in your library`, 'info');
        return r;
      } catch (err) {
        toast((err as Error).message, 'error');
        throw err;
      }
    },

    async downloadResult(r: SearchResult) {
      useUI.getState().markPending(r.key);
      return actions.importUrl(r.url);
    },

    async addToPlaylist(playlistId: number, tracks: Track[], name?: string) {
      await api.addToPlaylist(playlistId, tracks.map((t) => t.id));
      refresh('playlists', 'playlist');
      toast(`Added to ${name ?? 'playlist'}`, 'success');
    },

    async newPlaylistWith(tracks: Track[]) {
      const p = await api.createPlaylist(tracks.length === 1 ? tracks[0].title : 'New playlist', tracks.map((t) => t.id));
      refresh('playlists');
      navigate(`/playlist/${p.id}`);
    },

    async removeFromPlaylist(playlistId: number, t: Track) {
      await api.removeFromPlaylist(playlistId, t.id);
      refresh('playlist', 'playlists');
    },

    deleteTrack(t: Track) {
      useUI.getState().ask({
        title: 'Delete from library?',
        body: `“${t.title}” will be removed from every playlist and its file deleted from the server.`,
        confirmLabel: 'Delete',
        danger: true,
        onConfirm: async () => {
          const r = await api.deleteTrack(t.id);
          usePlayer.getState().dropTracks([t.id]);
          refresh('tracks', 'home', 'playlist', 'playlists', 'albums', 'artists', 'storage', 'system');
          toast(`Deleted · freed ${fmtBytes(r.freed)}`, 'success');
        },
      });
    },

    /** Deletes several songs after one confirmation. */
    deleteTracks(ids: number[], onDone?: () => void) {
      if (!ids.length) return;
      useUI.getState().ask({
        title: `Delete ${plural(ids.length, 'song')}?`,
        body: 'They will be removed from every playlist and their files deleted from the server. This cannot be undone.',
        confirmLabel: `Delete ${plural(ids.length, 'song')}`,
        danger: true,
        onConfirm: async () => {
          const r = await api.deleteTracks(ids);
          usePlayer.getState().dropTracks(ids);
          refresh('tracks', 'home', 'playlist', 'playlists', 'albums', 'artists', 'storage', 'system');
          toast(`Deleted ${plural(r.deleted, 'song')} · freed ${fmtBytes(r.freed)}`, 'success');
          onDone?.();
        },
      });
    },
  };
  return actions;
}
