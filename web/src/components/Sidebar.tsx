import { useQuery } from '@tanstack/react-query';
import { ArrowUpDown, Check, Heart, Link2, ListMusic, Loader2, Pin, Plus, Volume2, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { plural } from '../lib/format';
import { usePlayer } from '../store/player';
import { useTheme } from '../store/theme';
import { useUI } from '../store/ui';
import { Cover } from './Cover';
import { LibraryIcon, SearchIcon } from './Icons';
import { Menu, useMenu } from './Menu';
import { usePlaylistMenu } from './PlaylistMenu';

export function useActiveJobs() {
  // No polling: the live event stream (lib/events.ts) keeps this up to date.
  const { data } = useQuery({ queryKey: ['jobs'], queryFn: api.jobs, staleTime: 60_000 });
  return data?.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length ?? 0;
}

/** The purple "Liked Songs" picture with a white heart. */
export function LikedCover({ className = 'h-12 w-12', icon = 'h-4 w-4' }: { className?: string; icon?: string }) {
  return (
    <div className={`cover flex shrink-0 items-center justify-center bg-gradient-to-br from-[#450af5] via-[#8e8ee5] to-[#c4efd9] ${className}`}>
      <Heart className={`fill-white text-white ${icon}`} />
    </div>
  );
}

type Filter = 'playlists' | 'artists' | 'albums' | null;
type Sort = 'recents' | 'added' | 'alpha';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'recents', label: 'Recents' },
  { id: 'added', label: 'Recently Added' },
  { id: 'alpha', label: 'Alphabetical' },
];

interface Entry {
  key: string;
  to: string;
  title: string;
  subtitle: ReactNode;
  context: string;
  image: ReactNode;
  pinned?: boolean;
  order: number;
  playlist?: { id: number; name: string; count: number };
}

function useStored<T extends string | null>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
    } catch {
      return fallback;
    }
  });
  return [
    v,
    (n: T) => {
      setV(n);
      try {
        localStorage.setItem(key, JSON.stringify(n));
      } catch {
        /* private mode */
      }
    },
  ];
}

/** Spotify's "Your Library" panel: playlists, artists and albums, with filters, search and sorting. */
export function Sidebar() {
  const navigate = useNavigate();
  const collapsed = useUI((s) => s.libraryCollapsed);
  const toggleLibrary = useUI((s) => s.toggleLibrary);
  const openImport = useUI((s) => s.openImport);
  const context = usePlayer((s) => s.context);
  const playing = usePlayer((s) => s.playing);
  const [filter, setFilter] = useStored<Filter>('tuno-library-filter', null);
  const [sort, setSort] = useStored<Sort>('tuno-library-sort', 'recents');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const createMenu = useMenu();
  const sortMenu = useMenu();
  const playlistMenu = usePlaylistMenu();

  const { data: playlists, isSuccess } = useQuery({ queryKey: ['playlists'], queryFn: api.playlists });
  const { data: artists = [] } = useQuery({ queryKey: ['artists'], queryFn: api.artists, staleTime: 60_000 });
  const { data: albums = [] } = useQuery({ queryKey: ['albums'], queryFn: api.albums, staleTime: 60_000 });

  const newPlaylist = async () => {
    const p = await api.createPlaylist('New playlist');
    navigate(`/playlist/${p.id}`);
  };

  const entries = useMemo(() => {
    const list: Entry[] = [];
    if (!filter || filter === 'playlists') {
      list.push({
        key: 'liked',
        to: '/liked',
        title: 'Liked Songs',
        subtitle: 'Playlist',
        context: 'liked',
        image: <LikedCover />,
        pinned: true,
        order: Infinity,
      });
      for (const p of playlists ?? []) {
        list.push({
          key: `p${p.id}`,
          to: `/playlist/${p.id}`,
          title: p.name,
          subtitle:
            p.pending > 0 ? (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" /> {p.pending} downloading
              </span>
            ) : (
              `Playlist • ${plural(p.count, 'song')}`
            ),
          context: `playlist:${p.id}`,
          image: <Cover src={p.cover} mosaic={p.covers} className="h-12 w-12 shrink-0 shadow-none" />,
          order: sort === 'added' ? p.createdAt : p.updatedAt,
          playlist: p,
        });
      }
    }
    // Every artist and album of every song would bury the playlists, so "All" only lists the ones you have a few songs of.
    const min = filter ? 1 : 3;
    if (!filter || filter === 'artists') {
      for (const a of artists) {
        if (a.count < min) continue;
        list.push({
          key: `ar${a.artist}`,
          to: `/artist/${encodeURIComponent(a.artist)}`,
          title: a.artist,
          subtitle: 'Artist',
          context: `artist:${a.artist}`,
          image: <Cover src={a.cover} round className="h-12 w-12 shrink-0 shadow-none" />,
          order: a.count,
        });
      }
    }
    if (!filter || filter === 'albums') {
      for (const a of albums) {
        if (a.count < min) continue;
        list.push({
          key: `al${a.album}`,
          to: `/album/${encodeURIComponent(a.album)}`,
          title: a.album,
          subtitle: `Album • ${a.artist}`,
          context: `album:${a.album}`,
          image: <Cover src={a.cover} className="h-12 w-12 shrink-0 shadow-none" />,
          order: a.count,
        });
      }
    }
    const s = q.trim().toLowerCase();
    const shown = s ? list.filter((e) => e.title.toLowerCase().includes(s)) : list;
    const kind = (e: Entry) => (e.pinned ? 0 : e.playlist ? 1 : 2);
    return shown.sort((a, b) =>
      sort === 'alpha'
        ? kind(a) === 0 || kind(b) === 0
          ? kind(a) - kind(b)
          : a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
        : kind(a) - kind(b) || b.order - a.order,
    );
  }, [playlists, artists, albums, filter, sort, q]);

  const empty = isSuccess && playlists.length === 0;

  const row = (e: Entry) => {
    const isContext = context === e.context;
    return (
      <NavLink
        key={e.key}
        to={e.to}
        title={collapsed ? e.title : undefined}
        onContextMenu={e.playlist ? playlistMenu.onContextMenu(e.playlist) : undefined}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-text/[0.07] active:bg-black ${isActive ? 'bg-text/[0.1] hover:bg-text/[0.14]' : ''} ${
            collapsed ? 'justify-center' : ''
          }`
        }
      >
        {e.image}
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <div className={`truncate text-base leading-snug ${isContext ? 'text-accent' : 'text-text'}`}>{e.title}</div>
              <div className="flex items-center gap-1.5 truncate text-sm text-muted">
                {e.pinned && <Pin className="h-3.5 w-3.5 shrink-0 rotate-45 fill-accent text-accent" />}
                {e.subtitle}
              </div>
            </div>
            {isContext && playing && <Volume2 className="h-4 w-4 shrink-0 text-accent" />}
          </>
        )}
      </NavLink>
    );
  };

  return (
    <aside className={`panel flex h-full flex-col ${collapsed ? 'w-[72px]' : 'w-sidebar'}`}>
      <div className={`flex items-center gap-2 px-4 pb-2 pt-3 ${collapsed ? 'flex-col px-2' : ''}`}>
        <button
          onClick={toggleLibrary}
          className={`group flex min-w-0 items-center gap-3 rounded-md py-1 font-bold text-text transition-colors ${collapsed ? 'justify-center p-2 text-muted hover:text-text' : 'flex-1'}`}
          title={collapsed ? 'Expand Your Library' : 'Collapse Your Library'}
        >
          {collapsed ? <LibraryIcon className="h-6 w-6" /> : <span className="truncate text-base">Your Library</span>}
        </button>
        <button
          onClick={createMenu.open}
          className={`flex shrink-0 items-center gap-1.5 rounded-full bg-elevated font-bold text-text transition-colors hover:bg-[#2a2a2a] ${collapsed ? 'h-8 w-8 justify-center' : 'h-8 px-4 text-sm'}`}
          title="Create a playlist or download from a link"
        >
          <Plus className="h-4 w-4" />
          {!collapsed && 'Create'}
        </button>
      </div>

      {!collapsed && !empty && (
        <>
          <div className="no-scrollbar flex shrink-0 items-center gap-2 overflow-x-auto px-4 py-2">
            {filter && (
              <button onClick={() => setFilter(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-text/[0.07] hover:bg-text/[0.1]" aria-label="Clear filter">
                <X className="h-4 w-4" />
              </button>
            )}
            {(['playlists', 'artists', 'albums'] as const)
              .filter((f) => !filter || filter === f)
              .map((f) => (
                <button key={f} onClick={() => setFilter(filter === f ? null : f)} className={`shrink-0 capitalize ${filter === f ? 'chip-active' : 'chip'}`}>
                  {f}
                </button>
              ))}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 px-2 pb-1 pl-4">
            {searching ? (
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onBlur={() => !q && setSearching(false)}
                  onKeyDown={(e) => e.key === 'Escape' && (setQ(''), setSearching(false))}
                  placeholder="Search in Your Library"
                  className="h-8 w-full rounded bg-text/10 pl-8 pr-2 text-sm text-text outline-none placeholder:text-muted"
                />
              </div>
            ) : (
              <button onClick={() => setSearching(true)} className="-ml-2 rounded-full p-2 text-muted hover:bg-text/10 hover:text-text" title="Search in Your Library" aria-label="Search in Your Library">
                <SearchIcon className="h-4 w-4" />
              </button>
            )}
            <button onClick={sortMenu.open} className="flex shrink-0 items-center gap-1.5 px-2 py-1 text-sm text-muted transition-transform hover:scale-105 hover:text-text">
              {SORTS.find((s) => s.id === sort)?.label}
              <ArrowUpDown className="h-4 w-4" />
            </button>
          </div>
        </>
      )}

      <div className={`min-h-0 flex-1 overflow-y-auto ${collapsed ? 'px-1' : 'px-2'} pb-2`}>
        {empty && !collapsed ? (
          <div className="space-y-5 px-2 pt-2">
            <PromoCard title="Create your first playlist" body="It's easy, we'll help you" action="Create playlist" onClick={newPlaylist} />
            <PromoCard title="Let's find some music to keep" body="Paste a link from YouTube, SoundCloud or Spotify" action="Add from link" onClick={() => openImport()} />
            <div className="space-y-1">{entries.filter((e) => e.pinned).map(row)}</div>
          </div>
        ) : (
          <>
            {entries.map(row)}
            {!collapsed && q && entries.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">Couldn't find “{q}”</p>}
          </>
        )}
      </div>

      <Menu
        {...createMenu.props([
          { label: 'Playlist', icon: <ListMusic className="h-4 w-4" />, onClick: newPlaylist },
          { label: 'Download from link', icon: <Link2 className="h-4 w-4" />, onClick: () => openImport() },
        ])}
      />
      <Menu
        {...sortMenu.props(
          SORTS.map((s) => ({
            label: s.label,
            icon: sort === s.id ? <Check className="h-4 w-4 text-accent" /> : <span />,
            onClick: () => setSort(s.id),
          })),
        )}
      />
      {playlistMenu.element}
    </aside>
  );
}

function PromoCard({ title, body, action, onClick }: { title: string; body: string; action: string; onClick: () => void }) {
  return (
    <div className="rounded-lg bg-elevated px-5 py-4">
      <div className="font-bold">{title}</div>
      <div className="mt-2 text-sm">{body}</div>
      <button onClick={onClick} className="mt-5 rounded-full bg-text px-4 py-1.5 text-sm font-bold text-bg transition-transform hover:scale-105">
        {action}
      </button>
    </div>
  );
}

/** Drag the gap between Your Library and the page to resize the library. */
export function LibraryResizer() {
  const collapsed = useUI((s) => s.libraryCollapsed);
  const width = useTheme((s) => s.theme.sidebarWidth);
  if (collapsed) return <div className="w-2 shrink-0" />;
  return (
    <div
      className="group relative w-2 shrink-0 cursor-col-resize"
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const root = document.documentElement;
        let w = width;
        const move = (ev: PointerEvent) => {
          w = Math.round(Math.min(Math.max(width + ev.clientX - startX, 220), Math.min(480, window.innerWidth * 0.4)));
          root.style.setProperty('--sidebar-w', `${w}px`);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          useTheme.getState().set({ sidebarWidth: w });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      aria-hidden
    >
      <div className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-text/30 opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}
