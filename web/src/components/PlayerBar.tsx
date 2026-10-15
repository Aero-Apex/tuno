import {
  ChevronUp,
  CloudDownload,
  Heart,
  ListMusic,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useActions } from '../lib/actions';
import { fmtTime, SOURCE_LABEL } from '../lib/format';
import { extractColor } from '../lib/color';
import { audio, itemArtist, itemCover, itemTitle, usePlayer } from '../store/player';
import { useTheme } from '../store/theme';
import { useUI } from '../store/ui';
import { Cover } from './Cover';
import { Visualizer } from './Visualizer';

export function Seekbar({ className = '' }: { className?: string }) {
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const [drag, setDrag] = useState<number | null>(null);
  const value = drag ?? time;
  const pct = duration ? (value / duration) * 100 : 0;
  return (
    <div className={`flex w-full items-center gap-2 text-xs tabular-nums text-muted ${className}`}>
      <span className="w-10 text-right">{fmtTime(value)}</span>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={value}
        aria-label="Seek"
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag !== null) seek(drag);
          setDrag(null);
        }}
        onKeyUp={() => {
          if (drag !== null) seek(drag);
          setDrag(null);
        }}
        className="slider flex-1"
        style={{ ['--fill' as string]: `${pct}%` }}
      />
      <span className="w-10">{fmtTime(duration)}</span>
    </div>
  );
}

export function Controls({ big }: { big?: boolean }) {
  const { playing, loading, shuffle, repeat, toggle, next, prev, toggleShuffle, cycleRepeat } = usePlayer(
    useShallow((s) => ({
      playing: s.playing,
      loading: s.loading,
      shuffle: s.shuffle,
      repeat: s.repeat,
      toggle: s.toggle,
      next: s.next,
      prev: s.prev,
      toggleShuffle: s.toggleShuffle,
      cycleRepeat: s.cycleRepeat,
    })),
  );
  const size = big ? 'h-7 w-7' : 'h-5 w-5';
  return (
    <div className={`flex items-center ${big ? 'gap-6' : 'gap-4'}`}>
      <button onClick={toggleShuffle} className={`icon-btn relative ${shuffle ? 'text-accent hover:text-accent' : ''}`} title="Shuffle (S)" aria-label="Shuffle">
        <Shuffle className={big ? 'h-6 w-6' : 'h-4 w-4'} />
        {shuffle && <span className="absolute bottom-0 h-1 w-1 rounded-full bg-accent" />}
      </button>
      <button onClick={prev} className="icon-btn" title="Previous" aria-label="Previous">
        <SkipBack className={`${size} fill-current`} />
      </button>
      <button
        onClick={toggle}
        className={`flex items-center justify-center rounded-full bg-text text-bg transition-transform hover:scale-105 active:scale-95 ${big ? 'h-16 w-16' : 'h-9 w-9'}`}
        title="Play/Pause (Space)"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {loading && playing ? (
          <Loader2 className={`${size} animate-spin`} />
        ) : playing ? (
          <Pause className={`${size} fill-current`} />
        ) : (
          <Play className={`${size} translate-x-[1px] fill-current`} />
        )}
      </button>
      <button onClick={() => next()} className="icon-btn" title="Next" aria-label="Next">
        <SkipForward className={`${size} fill-current`} />
      </button>
      <button
        onClick={cycleRepeat}
        className={`icon-btn relative ${repeat !== 'off' ? 'text-accent hover:text-accent' : ''}`}
        title="Repeat (R)"
        aria-label="Repeat"
      >
        {repeat === 'one' ? <Repeat1 className={big ? 'h-6 w-6' : 'h-4 w-4'} /> : <Repeat className={big ? 'h-6 w-6' : 'h-4 w-4'} />}
        {repeat !== 'off' && <span className="absolute bottom-0 h-1 w-1 rounded-full bg-accent" />}
      </button>
    </div>
  );
}

export function Volume() {
  const { volume, muted, setVolume, toggleMute } = usePlayer(
    useShallow((s) => ({ volume: s.volume, muted: s.muted, setVolume: s.setVolume, toggleMute: s.toggleMute })),
  );
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="flex items-center gap-1">
      <button onClick={toggleMute} className="icon-btn" title="Mute (M)" aria-label="Mute">
        <Icon className="h-5 w-5" />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        className="slider w-24"
        aria-label="Volume"
        style={{ ['--fill' as string]: `${(muted ? 0 : volume) * 100}%` }}
      />
    </div>
  );
}

/** Saves a streamed search result into the library, or likes a library track. */
export function SaveButton({ big }: { big?: boolean }) {
  const item = usePlayer((s) => s.queue[s.index]);
  const actions = useActions();
  const [saving, setSaving] = useState(false);
  const cls = big ? 'h-7 w-7' : 'h-5 w-5';
  if (!item) return null;
  if (item.track) {
    return (
      <button
        onClick={() => actions.toggleLike(item.track!)}
        className={`icon-btn ${item.track.liked ? 'text-accent hover:text-accent' : ''}`}
        title="Like (L)"
        aria-label="Like"
      >
        <Heart className={`${cls} ${item.track.liked ? 'fill-current' : ''}`} />
      </button>
    );
  }
  return (
    <button
      disabled={saving}
      onClick={async () => {
        setSaving(true);
        await actions.importUrl(item.preview!.url).catch(() => {});
      }}
      className={`icon-btn ${saving ? 'text-accent' : ''}`}
      title="Download to library"
      aria-label="Download to library"
    >
      <CloudDownload className={cls} />
    </button>
  );
}

/** Keeps lock screen / headset controls and the dynamic accent in sync with the current song. */
function useNowPlayingEffects() {
  const item = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const setDynamic = useTheme((s) => s.setDynamic);
  const cover = itemCover(item);

  useEffect(() => {
    let alive = true;
    if (cover) extractColor(cover).then((c) => alive && setDynamic(c));
    else setDynamic(null);
    return () => {
      alive = false;
    };
  }, [cover, setDynamic]);

  useEffect(() => {
    document.title = item && playing ? `${itemTitle(item)} · ${itemArtist(item)}` : 'Tuno';
    if (!('mediaSession' in navigator) || !item) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: itemTitle(item),
      artist: itemArtist(item),
      album: item.track?.album ?? '',
      artwork: cover ? [{ src: new URL(cover, location.origin).href, sizes: '512x512' }] : [],
    });
  }, [item, playing, cover]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const p = usePlayer.getState;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => p().play()],
      ['pause', () => p().pause()],
      ['previoustrack', () => p().prev()],
      ['nexttrack', () => p().next()],
      ['seekto', (d) => d.seekTime != null && p().seek(d.seekTime)],
      ['seekbackward', () => p().seek(Math.max(0, audio.currentTime - 10))],
      ['seekforward', () => p().seek(audio.currentTime + 10)],
    ];
    for (const [a, h] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(a, h);
      } catch {
        /* unsupported action */
      }
    }
  }, []);
}

/** Thin progress line on the mobile mini player; isolated because it updates several times a second. */
function MiniProgress() {
  const pct = usePlayer((s) => (s.duration ? (s.time / s.duration) * 100 : 0));
  return (
    <div className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-text/20">
      <div className="h-full rounded bg-text" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PlayerBar() {
  useNowPlayingEffects();
  const item = usePlayer((s) => s.queue[s.index]);
  const error = usePlayer((s) => s.error);
  const playing = usePlayer((s) => s.playing);
  const toggle = usePlayer((s) => s.toggle);
  const { toggleQueue, queueOpen, setNowPlaying } = useUI();
  const showViz = useTheme((s) => s.theme.showVisualizer);

  const info = item ? (
    <div className="flex min-w-0 items-center gap-3">
      <button onClick={() => setNowPlaying(true)} className="group relative shrink-0" aria-label="Open now playing">
        <Cover src={itemCover(item)} className="h-14 w-14" />
        <span className="cover absolute inset-0 hidden items-center justify-center bg-black/50 group-hover:flex max-md:!hidden">
          <ChevronUp className="h-5 w-5" />
        </span>
      </button>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{itemTitle(item)}</div>
        <div className="truncate text-xs text-muted">
          {error ? <span className="text-red-400">{error}</span> : itemArtist(item)}
          {item.preview && !error && <span className="ml-1.5 rounded bg-text/10 px-1 py-px text-[10px] uppercase">{SOURCE_LABEL[item.preview.source] ?? 'Stream'}</span>}
        </div>
      </div>
      <div className="hidden md:block">
        <SaveButton />
      </div>
    </div>
  ) : (
    <div className="hidden text-sm text-muted md:block">Pick something to play</div>
  );

  return (
    <>
      {/* Desktop */}
      <div className="player-bar hidden h-[var(--player-h)] grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-4 px-4 md:grid">
        {info}
        <div className="flex flex-col items-center gap-1">
          <Controls />
          <Seekbar className="max-w-2xl" />
        </div>
        <div className="flex items-center justify-end gap-1">
          {showViz && playing && <Visualizer className="mr-2 h-6 w-16" />}
          <button onClick={() => setNowPlaying(true)} className="icon-btn" title="Now playing" aria-label="Now playing">
            <Maximize2 className="h-4 w-4" />
          </button>
          <button onClick={toggleQueue} className={`icon-btn ${queueOpen ? 'text-accent hover:text-accent' : ''}`} title="Queue (Q)" aria-label="Queue">
            <ListMusic className="h-5 w-5" />
          </button>
          <Volume />
        </div>
      </div>

      {/* Mobile mini player */}
      {item && (
        <div className="relative mx-2 mb-1 overflow-hidden rounded-md bg-elevated md:hidden" style={{ background: 'color-mix(in srgb, rgb(var(--c-dynamic)) 35%, rgb(var(--c-elevated)))' }}>
          <div className="flex items-center gap-3 p-2" onClick={() => setNowPlaying(true)}>
            <Cover src={itemCover(item)} className="h-10 w-10 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{itemTitle(item)}</div>
              <div className="truncate text-xs text-text/70">{error ?? itemArtist(item)}</div>
            </div>
            <div onClick={(e) => e.stopPropagation()} className="flex items-center">
              <SaveButton />
              <button onClick={toggle} className="p-2" aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause className="h-6 w-6 fill-current" /> : <Play className="h-6 w-6 fill-current" />}
              </button>
            </div>
          </div>
          <MiniProgress />
        </div>
      )}
    </>
  );
}
