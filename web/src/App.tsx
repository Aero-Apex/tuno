import { lazy, Suspense, useEffect, useRef } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { ConfirmDialog, EditTrackDialog, ImportDialog, Toasts } from './components/Dialogs';
import { MobileNav } from './components/MobileNav';
import { NowPlaying } from './components/NowPlaying';
import { RightPanel } from './components/NowPlayingView';
import { PlayerBar } from './components/PlayerBar';
import { LibraryResizer, Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { useActions } from './lib/actions';
import { useServerEvents } from './lib/events';
import { isUrl } from './lib/format';
import { AssistantPage } from './pages/Assistant';
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

/** The Now Playing view or queue on the right, with the same gap as between the other panels. */
function RightPanelSlot() {
  const panel = useUI((s) => s.rightPanel);
  const hasItem = usePlayer((s) => s.queue.length > 0);
  if (!(panel === 'queue' || (panel === 'nowplaying' && hasItem))) return null;
  return (
    <>
      <div className="w-2 shrink-0 max-lg:hidden" />
      <RightPanel />
    </>
  );
}

export default function App() {
  useServerEvents();
  useKeyboardShortcuts();
  const loadTheme = useTheme((s) => s.loadFromServer);
  const theme = useTheme((s) => s.theme);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  const floating = theme.player === 'floating';
  const right = theme.sidebar === 'right';

  return (
    <div className="relative flex h-full flex-col bg-surface">
      {theme.bgImage && (
        <div className="pointer-events-none fixed inset-0 -z-0" aria-hidden>
          <img src={theme.bgImage} alt="" className="h-full w-full scale-110 object-cover" style={{ filter: `blur(${theme.bgBlur}px)` }} />
          <div className="absolute inset-0 bg-black" style={{ opacity: theme.bgDim / 100 }} />
        </div>
      )}

      <div className="relative z-10">
        <TopBar />
      </div>
      <div className={`relative flex min-h-0 flex-1 md:px-2 ${right ? 'flex-row-reverse' : ''}`}>
        <div className="hidden md:block">
          <Sidebar />
        </div>
        <div className="hidden md:block">
          <LibraryResizer />
        </div>
        <main
          id="main-view"
          ref={mainRef}
          className="panel relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden max-md:rounded-none max-md:bg-bg"
        >
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
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<HomePage />} />
            </Routes>
          </Suspense>
          {/* Room for the floating mini player and tab bar on phones. */}
          <div className="h-[calc(136px+env(safe-area-inset-bottom))] md:hidden" />
        </main>
        <RightPanelSlot />
      </div>

      {/* On phones the mini player and tab bar float over the page with a fade to black behind them. */}
      <div className="max-md:pointer-events-none max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:bg-[linear-gradient(transparent_0,rgb(0_0_0/0.8)_30%,rgb(0_0_0/0.96)_55%,#000_100%)] max-md:pt-6">
        <div className={`relative z-40 max-md:pointer-events-auto ${floating ? 'md:mx-4 md:mb-4 md:rounded-xl md:bg-elevated/95 md:shadow-2xl md:backdrop-blur' : 'md:bg-surface'}`}>
          <PlayerBar />
        </div>
        <div className="relative z-40 max-md:pointer-events-auto">
          <MobileNav />
        </div>
      </div>

      <NowPlaying />
      <ImportDialog />
      <EditTrackDialog />
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}
