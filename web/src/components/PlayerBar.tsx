import {
  ChevronUp,
  CircleCheck,
  CirclePlus,
  CloudDownload,
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
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useActions } from '../lib/actions';
import { fmtTime, SOURCE_LABEL } from '../lib/format';
import { extractColor } from '../lib/color';
import { img } from '../lib/img';
import { audio, itemArtist, itemCover, itemTitle, usePlayer } from '../store/player';
import { useTheme } from '../store/theme';
import { useUI } from '../store/ui';
import { Cover } from './Cover';
import { NowPlayingViewIcon } from './Icons';
import { Visualizer } from './Visualizer';

export function Seekbar({ className = '' }: { className?: string }) {
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const [drag, setDrag] = useState<number | null>(null);
  const value = drag ?? time;
  const pct = duration ? Math.min(100, (value / duration) * 100) : 0;
  return (
    <div className={`flex w-full items-center gap-2 text-xs tabular-nums text-muted ${className}`}>
      <span className="min-w-10 text-right">{fmtTime(value)}</span>
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
  const size = big ? 'h-7 w-7' : 'h-4 w-4';
  const toggleCls = big ? 'h-6 w-6' : 'h-4 w-4';
  return (
    <div className={`flex items-center ${big ? 'gap-6' : 'gap-2'}`}>
      <button
        onClick={toggleShuffle}
        className={`icon-btn relative transition-transform hover:scale-105 ${shuffle ? 'text-accent hover:text-accent hover:brightness-110' : ''}`}
        title={shuffle ? 'Disable shuffle (S)' : 'Enable shuffle (S)'}
        aria-label="Shuffle"
        aria-pressed={shuffle}
      >
        <Shuffle className={toggleCls} />
        {shuffle && <span className="absolute bottom-0 h-1 w-1 rounded-full bg-accent" />}
      </button>
      <button onClick={prev} className="icon-btn transition-transform hover:scale-105" title="Previous" aria-label="Previous">
        <SkipBack className={`${size} fill-current`} />
      </button>
      <button
        onClick={toggle}
        className={`mx-2 flex items-center justify-center rounded-full bg-text text-bg transition-transform hover:scale-105 active:scale-95 ${big ? 'h-16 w-16' : 'h-8 w-8'}`}
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
      <button onClick={() => next()} className="icon-btn transition-transform hover:scale-105" title="Next" aria-label="Next">
        <SkipForward className={`${size} fill-current`} />
      </button>
      <button
        onClick={cycleRepeat}
        className={`icon-btn relative transition-transform hover:scale-105 ${repeat !== 'off' ? 'text-accent hover:text-accent hover:brightness-110' : ''}`}
        title={repeat === 'off' ? 'Enable repeat (R)' : repeat === 'all' ? 'Enable repeat one (R)' : 'Disable repeat (R)'}
        aria-label="Repeat"
      >
        {repeat === 'one' ? <Repeat1 className={toggleCls} /> : <Repeat className={toggleCls} />}
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
      <button onClick={toggleMute} className="icon-btn" title={muted ? 'Unmute (M)' : 'Mute (M)'} aria-label="Mute">
        <Icon className="h-4 w-4" />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        className="slider w-24 lg:w-[93px]"
        aria-label="Volume"
        style={{ ['--fill' as string]: `${(muted ? 0 : volume) * 100}%` }}
      />
    </div>
  );
}

/** Spotify's save button: an outlined plus, or a filled check once the song is in Liked Songs. */
export function LikeButton({ liked, onClick, className = 'h-4 w-4', reveal }: { liked: boolean; onClick: () => void; className?: string; reveal?: boolean }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`icon-btn transition-transform hover:scale-105 ${liked ? 'text-accent hover:text-accent' : reveal ? 'opacity-0 group-hover:opacity-100 max-md:opacity-100' : ''}`}
      title={liked ? 'Remove from Liked Songs (L)' : 'Add to Liked Songs (L)'}
      aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
      aria-pressed={liked}
    >
      {liked ? <CircleCheck className={`${className} fill-accent text-bg`} strokeWidth={2.5} /> : <CirclePlus className={className} />}
    </button>
  );
}

/** Saves a streamed search result into the library, or likes a library track. */
export function SaveButton({ big }: { big?: boolean }) {
  const item = usePlayer((s) => s.queue[s.index]);
  const actions = useActions();
  const [saving, setSaving] = useState(false);
  const cls = big ? 'h-6 w-6' : 'h-4 w-4';
  if (!item) return null;
  if (item.track) return <LikeButton liked={item.track.liked} onClick={() => actions.toggleLike(item.track!)} className={cls} />;
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
    // The color only needs a thumbnail, not the full-size cover.
    if (cover) extractColor(img(cover, 32) ?? cover).then((c) => alive && setDynamic(c));
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
  const rightPanel = useUI((s) => s.rightPanel);
  const { toggleQueue, toggleNowPlayingView, setNowPlaying } = useUI.getState();
  const showViz = useTheme((s) => s.theme.showVisualizer);
  const navigate = useNavigate();

  const info = item ? (
    <div className="flex min-w-0 items-center gap-3 pl-2">
      <button onClick={() => setNowPlaying(true)} className="group relative shrink-0" aria-label="Open full-screen player">
        <Cover src={itemCover(item)} className="h-14 w-14" />
        <span className="cover absolute inset-0 hidden items-center justify-center bg-black/50 group-hover:flex">
          <ChevronUp className="h-5 w-5" />
        </span>
      </button>
      <div className="min-w-0">
        {item.track?.album ? (
          <button onClick={() => navigate(`/album/${encodeURIComponent(item.track!.album!)}`)} className="block max-w-full truncate text-left text-sm hover:underline">
            {itemTitle(item)}
          </button>
        ) : (
          <div className="truncate text-sm">{itemTitle(item)}</div>
        )}
        <div className="truncate text-xs text-muted">
          {error ? (
            <span className="text-red-400">{error}</span>
          ) : item.track ? (
            <button onClick={() => navigate(`/artist/${encodeURIComponent(itemArtist(item))}`)} className="hover:text-text hover:underline">
              {itemArtist(item)}
            </button>
          ) : (
            itemArtist(item)
          )}
          {item.preview && !error && <span className="ml-1.5 rounded bg-text/10 px-1 py-px text-[10px] uppercase">{SOURCE_LABEL[item.preview.source] ?? 'Stream'}</span>}
        </div>
      </div>
      <div className="ml-1">
        <SaveButton />
      </div>
    </div>
  ) : (
    <div />
  );

  const active = (on: boolean) => (on ? 'relative text-accent hover:text-accent' : 'relative');
  const dot = <span className="absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />;

  return (
    <>
      {/* Desktop */}
      <div className="player-bar hidden h-[var(--player-h)] grid-cols-[minmax(180px,3fr)_minmax(0,4fr)_minmax(180px,3fr)] items-center gap-2 px-2 md:grid">
        {info}
        <div className="flex flex-col items-center gap-1">
          <Controls />
          <Seekbar className="max-w-[722px]" />
        </div>
        <div className="flex items-center justify-end gap-0.5 pr-2">
          {showViz && playing && <Visualizer className="mr-2 h-6 w-14 max-xl:hidden" />}
          <button
            onClick={toggleNowPlayingView}
            className={`icon-btn max-lg:hidden ${active(rightPanel === 'nowplaying')}`}
            title="Now playing view"
            aria-label="Now playing view"
            aria-pressed={rightPanel === 'nowplaying'}
          >
            <NowPlayingViewIcon />
            {rightPanel === 'nowplaying' && dot}
          </button>
          <button onClick={toggleQueue} className={`icon-btn ${active(rightPanel === 'queue')}`} title="Queue (Q)" aria-label="Queue" aria-pressed={rightPanel === 'queue'}>
            <ListMusic className="h-4 w-4" />
            {rightPanel === 'queue' && dot}
          </button>
          <Volume />
          <button onClick={() => setNowPlaying(true)} className="icon-btn" title="Full screen (F)" aria-label="Full screen">
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile mini player */}
      {item && (
        <div
          className="relative mx-2 mb-1 overflow-hidden rounded-md md:hidden"
          style={{ background: 'color-mix(in srgb, rgb(var(--c-dynamic)) 45%, #1a1a1a)' }}
        >
          <div className="flex items-center gap-2.5 p-2" onClick={() => setNowPlaying(true)}>
            <Cover src={itemCover(item)} className="h-10 w-10 shrink-0 !rounded" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{itemTitle(item)}</div>
              <div className="truncate text-sm text-text/70">{error ?? itemArtist(item)}</div>
            </div>
            <div onClick={(e) => e.stopPropagation()} className="flex items-center">
              <SaveButton big />
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
