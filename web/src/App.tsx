import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { ConfirmDialog, EditTrackDialog, ImportDialog, Toasts } from './components/Dialogs';
import { MobileNav } from './components/MobileNav';
import { NowPlaying } from './components/NowPlaying';
import { PlayerBar } from './components/PlayerBar';
import { QueuePanel } from './components/QueuePanel';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { useActions } from './lib/actions';
import { useServerEvents } from './lib/events';
import { isUrl } from './lib/format';
import { headerTint } from './lib/tint';
import { HomePage } from './pages/Home';
import { usePlayer } from './store/player';
import { useTheme } from './store/theme';
import { useUI } from './store/ui';

// Home ships with the app; every other page loads on first visit.
const SearchPage = lazy(() => import('./pages/Search').then((m) => ({ default: m.SearchPage })));
const LibraryPage = lazy(() => import('./pages/Library').then((m) => ({ default: m.LibraryPage })));
const LikedPage = lazy(() => import('./pages/Library').then((m) => ({ default: m.LikedPage })));
const PlaylistPage = lazy(() => import('./pages/Playlist').then((m) => ({ default: m.PlaylistPage })));
const AlbumPage = lazy(() => import('./pages/Collection').then((m) => ({ default: m.AlbumPage })));
const ArtistPage = lazy(() => import('./pages/Collection').then((m) => ({ default: m.ArtistPage })));
const DownloadsPage = lazy(() => import('./pages/Downloads').then((m) => ({ default: m.DownloadsPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

function useKeyboardShortcuts() {
  const actions = useActions();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const p = usePlayer.getState();
      const cur = p.queue[p.index];
      switch (e.key) {
        case ' ':
          e.preventDefault();
          p.toggle();
          break;
        case 'ArrowRight':
          if (e.shiftKey) p.next();
          else p.seek(Math.min(p.duration, p.time + 5));
          break;
        case 'ArrowLeft':
          if (e.shiftKey) p.prev();
          else p.seek(Math.max(0, p.time - 5));
          break;
        case 'ArrowUp':
          e.preventDefault();
          p.setVolume(p.volume + 0.05);
          break;
        case 'ArrowDown':
          e.preventDefault();
          p.setVolume(p.volume - 0.05);
          break;
        case 'm':
          p.toggleMute();
          break;
        case 's':
          p.toggleShuffle();
          break;
        case 'r':
          p.cycleRepeat();
          break;
        case 'l':
          if (cur?.track) actions.toggleLike(cur.track);
          break;
        case 'q':
          useUI.getState().toggleQueue();
          break;
        case 'f':
          useUI.getState().setNowPlaying(!useUI.getState().nowPlayingOpen);
          break;
        case '/':
          e.preventDefault();
          window.dispatchEvent(new Event('tuno:focus-search'));
          break;
      }
    };
    // Pasting a link anywhere (outside a text field) opens the download dialog.
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, [contenteditable]')) return;
      const text = e.clipboardData?.getData('text')?.trim();
      if (text && isUrl(text)) useUI.getState().openImport(text);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

export default function App() {
  useServerEvents();
  useKeyboardShortcuts();
  const loadTheme = useTheme((s) => s.loadFromServer);
  const theme = useTheme((s) => s.theme);
  const queueOpen = useUI((s) => s.queueOpen);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [tint, setTint] = useState<string | null>(null);

  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  useEffect(() => {
    const l = () => setTint(headerTint.current);
    headerTint.listeners.add(l);
    return () => void headerTint.listeners.delete(l);
  }, []);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    setScrolled(false);
  }, [location.pathname]);

  const floating = theme.player === 'floating';

  return (
    <div className="relative flex h-full flex-col">
      {theme.bgImage && (
        <div className="pointer-events-none fixed inset-0 -z-0" aria-hidden>
          <img src={theme.bgImage} alt="" className="h-full w-full scale-110 object-cover" style={{ filter: `blur(${theme.bgBlur}px)` }} />
          <div className="absolute inset-0 bg-black" style={{ opacity: theme.bgDim / 100 }} />
        </div>
      )}

      <div className={`relative flex min-h-0 flex-1 gap-2 p-0 md:p-2 ${theme.sidebar === 'right' ? 'flex-row-reverse' : ''}`}>
        <div className="hidden md:block">
          <Sidebar />
        </div>
        <main
          ref={mainRef}
          onScroll={(e) => setScrolled((e.target as HTMLElement).scrollTop > 40)}
          className="panel relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden max-md:rounded-none"
        >
          <TopBar scrolled={scrolled} tint={tint} />
          <div className="relative -mt-[68px]">
            <Suspense fallback={<div className="h-screen" />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/liked" element={<LikedPage />} />
              <Route path="/playlist/:id" element={<PlaylistPage />} />
              <Route path="/album/:name" element={<AlbumPage />} />
              <Route path="/artist/:name" element={<ArtistPage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<HomePage />} />
            </Routes>
            </Suspense>
          </div>
        </main>
        {queueOpen && <QueuePanel />}
      </div>

      <div className={`relative z-40 ${floating ? 'md:mx-4 md:mb-4 md:rounded-xl md:bg-elevated/95 md:shadow-2xl md:backdrop-blur' : 'md:bg-surface'}`}>
        <PlayerBar />
      </div>
      <div className="relative z-40">
        <MobileNav />
      </div>

      <NowPlaying />
      <ImportDialog />
      <EditTrackDialog />
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}
