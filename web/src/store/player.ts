import { create } from 'zustand';
import { api, previewUrl, streamUrl, type SearchResult, type Track } from '../lib/api';
import { img } from '../lib/img';

/** Something playable: a downloaded track, or a search result streamed straight from its source. */
export interface QueueItem {
  qid: string;
  track?: Track;
  preview?: { url: string; title: string; artist: string; thumbnail?: string | null; duration?: number | null; source: string };
}

export const itemTitle = (i?: QueueItem) => i?.track?.title ?? i?.preview?.title ?? '';
export const itemArtist = (i?: QueueItem) => i?.track?.artist ?? i?.preview?.artist ?? '';
export const itemCover = (i?: QueueItem) => (i?.track ? i.track.cover : img(i?.preview?.thumbnail)) ?? null;
export const itemDuration = (i?: QueueItem) => i?.track?.duration ?? i?.preview?.duration ?? null;
const itemSrc = (i: QueueItem) => (i.track ? streamUrl(i.track) : previewUrl(i.preview!.url));

let qidCounter = 0;
const qid = () => `${Date.now().toString(36)}-${qidCounter++}`;
export const fromTrack = (track: Track): QueueItem => ({ qid: qid(), track });
export const fromResult = (r: SearchResult): QueueItem => ({
  qid: qid(),
  preview: { url: r.url, title: r.title, artist: r.artist, thumbnail: r.thumbnail, duration: r.duration, source: r.source },
});

type Repeat = 'off' | 'all' | 'one';

interface PlayerState {
  queue: QueueItem[];
  /** Queue order before shuffle was switched on, to restore it. */
  unshuffled: QueueItem[] | null;
  index: number;
  playing: boolean;
  loading: boolean;
  error: string | null;
  time: number;
  duration: number;
  buffered: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  /** Where the current queue came from, e.g. "playlist:3", so the UI can show what's playing. */
  context: string | null;

  playItems: (items: QueueItem[], start?: number, context?: string | null) => void;
  playTracks: (tracks: Track[], start?: number, context?: string | null) => void;
  playNext: (items: QueueItem[]) => void;
  addToQueue: (items: QueueItem[]) => void;
  removeFromQueue: (qid: string) => void;
  moveInQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  jumpTo: (index: number) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  updateTrack: (t: Track) => void;
  /** Removes deleted library songs from the queue (stopping playback if the current one is gone). */
  dropTracks: (ids: number[]) => void;
  /** Stops playback and empties the queue (on log out / switching accounts). */
  reset: () => void;
}

export const audio = new Audio();
audio.preload = 'auto';

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let loadedQid: string | null = null;
let countedQid: string | null = null;

function load(item: QueueItem | undefined, autoplay: boolean, startAt = 0) {
  if (!item) {
    audio.removeAttribute('src');
    audio.load();
    loadedQid = null;
    return;
  }
  if (loadedQid !== item.qid) {
    loadedQid = item.qid;
    audio.src = itemSrc(item);
    if (startAt) audio.currentTime = startAt;
    usePlayer.setState({ time: startAt, duration: itemDuration(item) ?? 0, buffered: 0, error: null, loading: true });
  }
  if (autoplay) audio.play().catch(() => usePlayer.setState({ playing: false }));
}

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('tuno-player') ?? 'null') as Partial<PlayerState> | null;
  } catch {
    return null;
  }
})();

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: saved?.queue ?? [],
  unshuffled: null,
  index: saved?.index ?? 0,
  playing: false,
  loading: false,
  error: null,
  time: saved?.time ?? 0,
  // Until the restored song is loaded, show its known length rather than 0:00.
  duration: itemDuration(saved?.queue?.[saved?.index ?? 0]) ?? 0,
  buffered: 0,
  volume: saved?.volume ?? 0.8,
  muted: false,
  shuffle: saved?.shuffle ?? false,
  repeat: saved?.repeat ?? 'off',
  context: saved?.context ?? null,

  playItems: (items, start = 0, context = null) => {
    if (!items.length) return;
    let queue = items;
    let index = start;
    if (get().shuffle) {
      const first = items[start];
      queue = [first, ...shuffled(items.filter((_, i) => i !== start))];
      index = 0;
      set({ unshuffled: items });
    } else set({ unshuffled: null });
    set({ queue, index, context });
    load(queue[index], true);
  },
  playTracks: (tracks, start = 0, context = null) => get().playItems(tracks.map(fromTrack), start, context),
  playNext: (items) => {
    const { queue, index, unshuffled } = get();
    if (!queue.length) return get().playItems(items);
    // Keep the pre-shuffle order in sync so turning shuffle off doesn't drop these songs.
    set({ queue: [...queue.slice(0, index + 1), ...items, ...queue.slice(index + 1)], unshuffled: unshuffled && [...unshuffled, ...items] });
  },
  addToQueue: (items) => {
    const { queue, unshuffled } = get();
    if (!queue.length) return get().playItems(items);
    set({ queue: [...queue, ...items], unshuffled: unshuffled && [...unshuffled, ...items] });
  },
  removeFromQueue: (id) => {
    const { queue, index, unshuffled } = get();
    const i = queue.findIndex((q) => q.qid === id);
    if (i < 0) return;
    const next = queue.filter((q) => q.qid !== id);
    if (unshuffled) set({ unshuffled: unshuffled.filter((q) => q.qid !== id) });
    if (i === index) {
      set({ queue: next, index: Math.min(index, next.length - 1) });
      load(next[Math.min(index, next.length - 1)], get().playing);
    } else set({ queue: next, index: i < index ? index - 1 : index });
  },
  moveInQueue: (from, to) => {
    const { queue, index } = get();
    const q = [...queue];
    const [it] = q.splice(from, 1);
    q.splice(to, 0, it);
    const current = queue[index];
    set({ queue: q, index: q.indexOf(current) });
  },
  clearQueue: () => {
    const { queue, index } = get();
    const current = queue[index];
    set({ queue: current ? [current] : [], index: 0, unshuffled: null });
  },
  jumpTo: (i) => {
    set({ index: i });
    load(get().queue[i], true);
  },
  toggle: () => (audio.paused ? get().play() : get().pause()),
  play: () => {
    const { queue, index, time } = get();
    if (!queue.length) return;
    if (!audio.src || loadedQid !== queue[index]?.qid) load(queue[index], true, time);
    else audio.play().catch(() => {});
  },
  pause: () => audio.pause(),
  next: (auto = false) => {
    const { queue, index, repeat } = get();
    if (!queue.length) return;
    if (auto && repeat === 'one') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    let ni = index + 1;
    if (ni >= queue.length) {
      if (repeat === 'off' && auto) {
        set({ playing: false });
        audio.currentTime = 0;
        audio.pause();
        return;
      }
      ni = 0;
    }
    set({ index: ni });
    load(queue[ni], true);
  },
  prev: () => {
    const { queue, index } = get();
    if (audio.currentTime > 3 || index === 0) {
      audio.currentTime = 0;
      return;
    }
    set({ index: index - 1 });
    load(queue[index - 1], true);
  },
  seek: (t) => {
    if (Number.isFinite(t)) audio.currentTime = t;
    set({ time: t });
  },
  setVolume: (v) => {
    v = Math.min(1, Math.max(0, v));
    audio.volume = v;
    set({ volume: v, muted: v === 0 ? get().muted : false });
    audio.muted = v === 0 ? audio.muted : false;
  },
  toggleMute: () => {
    audio.muted = !audio.muted;
    set({ muted: audio.muted });
  },
  toggleShuffle: () => {
    const { shuffle, queue, index, unshuffled } = get();
    const current = queue[index];
    if (!shuffle) {
      const rest = shuffled(queue.filter((_, i) => i !== index));
      set({ shuffle: true, unshuffled: queue, queue: current ? [current, ...rest] : rest, index: 0 });
    } else {
      // Restore the original order, plus anything that's in the queue but somehow not in it.
      const known = new Set(unshuffled?.map((q) => q.qid));
      const base = unshuffled ? [...unshuffled, ...queue.filter((q) => !known.has(q.qid))] : queue;
      set({ shuffle: false, unshuffled: null, queue: base, index: Math.max(0, base.indexOf(current)) });
    }
  },
  cycleRepeat: () => set({ repeat: get().repeat === 'off' ? 'all' : get().repeat === 'all' ? 'one' : 'off' }),
  updateTrack: (t) =>
    set({ queue: get().queue.map((q) => (q.track?.id === t.id ? { ...q, track: t } : q)) }),
  reset: () => {
    audio.pause();
    load(undefined, false);
    set({ queue: [], unshuffled: null, index: 0, time: 0, duration: 0, playing: false, context: null, error: null });
  },
  dropTracks: (ids) => {
    const gone = new Set(ids);
    const { queue, index, unshuffled } = get();
    const keep = (q: QueueItem) => !(q.track && gone.has(q.track.id));
    const current = queue[index];
    const next = queue.filter(keep);
    if (next.length === queue.length) return;
    if (current && !keep(current)) {
      // The playing song was deleted: stop, and cue up whatever comes next without auto-playing.
      audio.pause();
      const removedBefore = queue.slice(0, index).filter((q) => !keep(q)).length;
      const ni = Math.min(index - removedBefore, next.length - 1);
      set({ queue: next, index: Math.max(0, ni), unshuffled: unshuffled?.filter(keep) ?? null, playing: false });
      load(next[Math.max(0, ni)], false);
    } else {
      set({ queue: next, index: next.indexOf(current), unshuffled: unshuffled?.filter(keep) ?? null });
    }
  },
}));

audio.volume = usePlayer.getState().volume;

audio.addEventListener('play', () => usePlayer.setState({ playing: true }));
audio.addEventListener('pause', () => usePlayer.setState({ playing: false }));
audio.addEventListener('waiting', () => usePlayer.setState({ loading: true }));
audio.addEventListener('canplay', () => usePlayer.setState({ loading: false }));
audio.addEventListener('playing', () => {
  usePlayer.setState({ loading: false, error: null });
  const { queue, index } = usePlayer.getState();
  const cur = queue[index];
  // Look up the next streamed song's audio now so skipping to it is instant.
  const upcoming = queue[index + 1];
  if (upcoming?.preview) api.warmPreview(upcoming.preview.url);
  if (cur?.track && countedQid !== cur.qid) {
    countedQid = cur.qid;
    api.markPlayed(cur.track.id).catch(() => {});
  }
});
audio.addEventListener('timeupdate', () => usePlayer.setState({ time: audio.currentTime }));
audio.addEventListener('durationchange', () => {
  if (Number.isFinite(audio.duration)) usePlayer.setState({ duration: audio.duration });
});
audio.addEventListener('progress', () => {
  if (audio.buffered.length) usePlayer.setState({ buffered: audio.buffered.end(audio.buffered.length - 1) });
});
audio.addEventListener('ended', () => usePlayer.getState().next(true));
// A song that can't be played (deleted file, removed upload…) is skipped automatically,
// but stop after a few in a row so a dead queue doesn't spin forever.
let errorStreak = 0;
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src')) return;
  usePlayer.setState({ loading: false, playing: false, error: 'Could not play this track' });
  const { queue, index } = usePlayer.getState();
  if (++errorStreak <= 3 && index < queue.length - 1) {
    const failed = queue[index]?.qid;
    setTimeout(() => {
      // Only skip if the user hasn't picked something else meanwhile.
      const s = usePlayer.getState();
      if (s.queue[s.index]?.qid === failed) s.next();
    }, 1500);
  }
});
audio.addEventListener('playing', () => (errorStreak = 0));

// Remember the queue and position across reloads (per device). Throttled: playback updates
// the state several times a second, and the queue can be long.
let saveTimer: number | undefined;
usePlayer.subscribe(() => {
  if (saveTimer) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    const s = usePlayer.getState();
    try {
      localStorage.setItem(
        'tuno-player',
        JSON.stringify({
          queue: s.queue.slice(0, 1000),
          index: s.index,
          time: s.time,
          volume: s.volume,
          shuffle: s.shuffle,
          repeat: s.repeat,
          context: s.context,
        }),
      );
    } catch {
      /* storage full or unavailable */
    }
  }, 3000);
});
window.addEventListener('pagehide', () => {
  const s = usePlayer.getState();
  try {
    localStorage.setItem(
      'tuno-player',
      JSON.stringify({ queue: s.queue.slice(0, 1000), index: s.index, time: s.time, volume: s.volume, shuffle: s.shuffle, repeat: s.repeat, context: s.context }),
    );
  } catch {
    /* ignore */
  }
});

/** Common slice for "play this list / is this list playing" buttons; use with useShallow. */
export const contextSlice = (s: PlayerState) => ({ context: s.context, playing: s.playing, toggle: s.toggle, playTracks: s.playTracks });

export const currentItem = () => {
  const { queue, index } = usePlayer.getState();
  return queue[index];
};
