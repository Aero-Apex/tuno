import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Job } from './api';
import { useUI } from '../store/ui';

/** A hidden tab drops its live connection after this long; the phone/PC isn't waiting for anything. */
const HIDDEN_GRACE_MS = 60_000;

/**
 * Listens to the server's live event stream and keeps cached data fresh. The stream is closed while the tab
 * is in the background (saves battery, data and a server connection) and everything is refreshed once on return.
 */
export function useServerEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    let timer: number | undefined;
    let es: EventSource | null = null;
    let closeTimer: number | undefined;
    const pending = new Set<string>();
    const invalidate = (...keys: string[]) => {
      keys.forEach((k) => pending.add(k));
      // Batch: during a big import songs finish every few seconds; refresh at most once a second.
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        for (const k of pending) qc.invalidateQueries({ queryKey: [k] });
        pending.clear();
      }, 1000);
    };

    const onMessage = (e: MessageEvent) => {
      const ev = JSON.parse(e.data) as { type: string; job?: Job };
      if (ev.type === 'job' && ev.job) {
        const job = ev.job;
        qc.setQueryData<{ jobs: Job[]; stats: unknown }>(['jobs'], (old) => {
          if (!old) return old;
          const idx = old.jobs.findIndex((j) => j.id === job.id);
          const jobs = [...old.jobs];
          if (idx >= 0) jobs[idx] = job;
          else jobs.unshift(job);
          return { ...old, jobs };
        });
        if (job.status === 'done' || job.status === 'error') invalidate('jobs');
        // Playlist imports show failures on the Downloads page instead of a toast per song.
        if (job.status === 'error' && !job.playlistId) useUI.getState().toast(`Couldn't download “${job.title ?? job.url}”: ${job.error}`, 'error');
      } else if (ev.type === 'jobs-cleared') invalidate('jobs');
      else if (ev.type === 'library') invalidate('tracks', 'home', 'albums', 'artists', 'playlist', 'search', 'playlists', 'storage', 'me', 'jobs');
      else if (ev.type === 'playlists') invalidate('playlists', 'playlist');
    };

    const open = () => {
      if (es) return;
      es = new EventSource('/api/events');
      es.onmessage = onMessage;
      // After the connection (re)opens we may have missed events: refresh once.
      let first = true;
      es.onopen = () => {
        if (first) first = false;
        else invalidate('jobs', 'tracks', 'home', 'playlists', 'playlist', 'storage', 'me');
      };
    };
    const close = () => {
      es?.close();
      es = null;
    };

    const onVisibility = () => {
      if (document.hidden) {
        closeTimer = window.setTimeout(close, HIDDEN_GRACE_MS);
      } else {
        clearTimeout(closeTimer);
        if (!es) {
          open();
          invalidate('jobs', 'tracks', 'home', 'playlists', 'playlist', 'storage', 'me');
        }
      }
    };

    open();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      close();
      clearTimeout(timer);
      clearTimeout(closeTimer);
    };
  }, [qc]);
}
