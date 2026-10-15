import { useQuery } from '@tanstack/react-query';
import { Download, Heart, Home, Library, Link2, Loader2, Plus, Search, Settings, Volume2 } from 'lucide-react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtBytes, plural } from '../lib/format';
import { useAuth } from '../store/auth';
import { usePlayer } from '../store/player';
import { useUI } from '../store/ui';
import { Cover } from './Cover';
import { Logo } from './Logo';

export function useActiveJobs() {
  const { data } = useQuery({ queryKey: ['jobs'], queryFn: api.jobs, refetchInterval: 15_000 });
  return data?.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length ?? 0;
}

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/library', label: 'Your Library', icon: Library },
  { to: '/downloads', label: 'Downloads', icon: Download },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/** Who's signed in and how full their storage is; links to Settings → Account. */
function AccountChip() {
  const user = useAuth((s) => s.user);
  const { data } = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });
  if (!user) return null;
  const used = data?.used ?? 0;
  const pct = Math.min(100, (used / user.quotaBytes) * 100);
  return (
    <Link to="/settings?tab=account" className="mt-3 flex items-center gap-3 rounded px-3 py-2 transition-colors hover:bg-text/10" title="Account">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-text/10 text-sm font-bold">{user.name.slice(0, 1).toUpperCase()}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{user.name}</span>
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-text/10">
          <span className={`block h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 85 ? 'bg-amber-400' : 'bg-accent'}`} style={{ width: `${Math.max(pct, used ? 2 : 0)}%` }} />
        </span>
        <span className="mt-0.5 block text-[11px] text-muted">
          {fmtBytes(used)} of {fmtBytes(user.quotaBytes)}
        </span>
      </span>
    </Link>
  );
}

export function Sidebar() {
  const active = useActiveJobs();
  const openImport = useUI((s) => s.openImport);
  const navigate = useNavigate();
  const context = usePlayer((s) => s.context);
  const playing = usePlayer((s) => s.playing);
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: api.playlists });

  const newPlaylist = async () => {
    const p = await api.createPlaylist('New playlist');
    navigate(`/playlist/${p.id}`);
  };

  return (
    <aside className="flex h-full w-sidebar flex-col gap-2">
      <nav className="panel px-3 py-4">
        <div className="mb-4 px-3">
          <Logo />
        </div>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-4 rounded px-3 py-2.5 font-semibold transition-colors ${isActive ? 'text-text' : 'text-muted hover:text-text'}`
            }
          >
            <Icon className="h-6 w-6" />
            <span className="flex-1">{label}</span>
            {to === '/downloads' && active > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-on-accent">
                <Loader2 className="h-3 w-3 animate-spin" />
                {active}
              </span>
            )}
          </NavLink>
        ))}
        <button onClick={() => openImport()} className="btn-accent mt-4 w-full">
          <Link2 className="h-4 w-4" />
          Add from link
        </button>
        <AccountChip />
      </nav>

      <div className="panel flex min-h-0 flex-1 flex-col py-3">
        <div className="flex items-center justify-between px-5 pb-2">
          <span className="font-semibold text-muted">Playlists</span>
          <button onClick={newPlaylist} className="icon-btn hover:bg-text/10" title="Create playlist" aria-label="Create playlist">
            <Plus className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          <NavLink
            to="/liked"
            className={({ isActive }) => `flex items-center gap-3 rounded p-2 transition-colors hover:bg-text/10 ${isActive ? 'bg-text/10' : ''}`}
          >
            <div className="cover flex h-12 w-12 shrink-0 items-center justify-center bg-gradient-to-br from-accent to-accent/30">
              <Heart className="h-5 w-5 fill-on-accent text-on-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <div className={`truncate font-medium ${context === 'liked' ? 'text-accent' : ''}`}>Liked Songs</div>
              <div className="truncate text-sm text-muted">Playlist</div>
            </div>
          </NavLink>
          {playlists.map((p) => (
            <NavLink
              key={p.id}
              to={`/playlist/${p.id}`}
              className={({ isActive }) => `flex items-center gap-3 rounded p-2 transition-colors hover:bg-text/10 ${isActive ? 'bg-text/10' : ''}`}
            >
              <Cover src={p.cover} mosaic={p.covers} className="h-12 w-12 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className={`truncate font-medium ${context === `playlist:${p.id}` ? 'text-accent' : ''}`}>{p.name}</div>
                <div className="flex items-center gap-1 truncate text-sm text-muted">
                  {p.pending > 0 && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />}
                  {p.pending > 0 ? `${p.pending} downloading` : `Playlist · ${plural(p.count, 'song')}`}
                </div>
              </div>
              {context === `playlist:${p.id}` && playing && <Volume2 className="h-4 w-4 shrink-0 text-accent" />}
            </NavLink>
          ))}
        </div>
      </div>
    </aside>
  );
}
