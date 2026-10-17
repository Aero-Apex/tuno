import { ChevronDown, ListMusic, Music2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { SOURCE_LABEL } from '../lib/format';
import { itemArtist, itemCover, itemTitle, usePlayer } from '../store/player';
import { useTheme } from '../store/theme';
import { useUI } from '../store/ui';
import { Cover } from './Cover';
import { useContextName } from '../lib/playContext';
import { Controls, SaveButton, Seekbar, Volume } from './PlayerBar';
import { QueueList } from './QueuePanel';
import { Visualizer } from './Visualizer';

/** Full-screen player with a big cover and the album colors washed over the background. */
export function NowPlaying() {
  const { nowPlayingOpen, setNowPlaying } = useUI();
  const item = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const showViz = useTheme((s) => s.theme.showVisualizer);
  const [tab, setTab] = useState<'cover' | 'queue'>('cover');
  const navigate = useNavigate();
  const cover = itemCover(item);
  const context = usePlayer((s) => s.context);
  const ctx = useContextName();

  useEffect(() => {
    if (!nowPlayingOpen) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setNowPlaying(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [nowPlayingOpen, setNowPlaying]);

  if (!nowPlayingOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex animate-fade-in flex-col overflow-hidden bg-bg">
      {cover && <img src={cover} alt="" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-50 blur-3xl" aria-hidden />}
      <div className="absolute inset-0 bg-gradient-to-b from-dynamic/40 via-bg/70 to-bg" />

      <div className="relative flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button onClick={() => setNowPlaying(false)} className="icon-btn text-text" aria-label="Close">
          <ChevronDown className="h-7 w-7" />
        </button>
        <div className="min-w-0 px-2 text-center">
          <div className="text-[11px] uppercase tracking-widest text-text/80">{item?.preview ? 'Streaming from' : context ? 'Playing from' : 'Now playing'}</div>
          <div className="truncate text-sm font-bold">{item?.preview ? SOURCE_LABEL[item.preview.source] ?? 'the web' : context ? ctx.name : ''}</div>
        </div>
        <button onClick={() => setTab(tab === 'cover' ? 'queue' : 'cover')} className={`icon-btn ${tab === 'queue' ? 'text-accent' : 'text-text'}`} aria-label="Queue">
          <ListMusic className="h-6 w-6" />
        </button>
      </div>

      <div className="relative mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col items-center justify-center gap-8 px-6 pb-8 lg:flex-row lg:gap-16">
        <div className={`flex min-h-0 w-full flex-1 items-center justify-center ${tab === 'queue' ? 'max-lg:hidden' : ''}`}>
          {item ? (
            <Cover src={cover} className="aspect-square max-h-[min(60vh,560px)] w-full max-w-[560px] shadow-2xl" />
          ) : (
            <Music2 className="h-32 w-32 text-muted" />
          )}
        </div>
        <div className={`flex w-full max-w-xl flex-col gap-6 ${tab === 'queue' ? 'min-h-0 flex-1' : ''}`}>
          {tab === 'queue' ? (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-black/20 p-2">
              <QueueList compact />
            </div>
          ) : (
            <>
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="line-clamp-2 text-3xl font-extrabold leading-tight md:text-4xl">{itemTitle(item) || 'Nothing playing'}</h1>
                  <button
                    onClick={() => {
                      if (!item) return;
                      setNowPlaying(false);
                      navigate(`/artist/${encodeURIComponent(itemArtist(item))}`);
                    }}
                    className="mt-1 truncate text-lg text-text/70 hover:text-text hover:underline"
                  >
                    {itemArtist(item)}
                  </button>
                </div>
                <SaveButton big />
              </div>
              {showViz && playing && <Visualizer className="h-12 w-full opacity-80" bars={40} />}
            </>
          )}
          <Seekbar />
          <div className="flex justify-center">
            <Controls big />
          </div>
          <div className="hidden justify-center md:flex">
            <Volume />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
