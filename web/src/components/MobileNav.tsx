import { Link2, ListMusic, Plus } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useUI } from '../store/ui';
import { HomeIcon, LibraryIcon, SearchIcon } from './Icons';

/** Spotify's bottom tab bar on phones: Home, Search, Your Library and Create. */
export function MobileNav() {
  const [creating, setCreating] = useState(false);
  const item = 'flex flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-[10px] tracking-wide';
  const cls = ({ isActive }: { isActive: boolean }) => `${item} ${isActive ? 'text-text' : 'text-muted'}`;
  return (
    <>
      <nav className="safe-bottom flex md:hidden">
        <NavLink to="/" end className={cls}>
          {({ isActive }) => (
            <>
              <HomeIcon filled={isActive} className="h-6 w-6" />
              Home
            </>
          )}
        </NavLink>
        <NavLink to="/search" className={cls}>
          {({ isActive }) => (
            <>
              <SearchIcon filled={isActive} className="h-6 w-6" />
              Search
            </>
          )}
        </NavLink>
        <NavLink to="/library" className={cls}>
          {({ isActive }) => (
            <>
              <LibraryIcon filled={isActive} className="h-6 w-6" />
              Your Library
            </>
          )}
        </NavLink>
        <button onClick={() => setCreating(true)} className={`${item} text-muted`}>
          <Plus className="h-6 w-6" />
          Create
        </button>
      </nav>
      {creating && <CreateSheet onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const openImport = useUI((s) => s.openImport);
  const option = (icon: React.ReactNode, title: string, body: string, onClick: () => void) => (
    <button
      onClick={() => {
        onClose();
        onClick();
      }}
      className="flex w-full items-center gap-4 px-4 py-3 text-left active:bg-text/10"
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-text/10">{icon}</span>
      <span className="min-w-0">
        <span className="block font-bold">{title}</span>
        <span className="block text-sm text-muted">{body}</span>
      </span>
    </button>
  );
  return createPortal(
    <div className="fixed inset-0 z-[90] flex animate-fade-in flex-col justify-end bg-black/70 md:hidden" onClick={onClose}>
      <div className="safe-bottom rounded-t-xl bg-[#282828] pb-4 pt-2" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-text/30" />
        {option(<ListMusic className="h-6 w-6" />, 'Playlist', 'Build a playlist with songs from your library', async () => {
          const p = await api.createPlaylist('New playlist');
          navigate(`/playlist/${p.id}`);
        })}
        {option(<Link2 className="h-6 w-6" />, 'Download from link', 'Paste a link from YouTube, SoundCloud, Spotify…', () => openImport())}
      </div>
    </div>,
    document.body,
  );
}
