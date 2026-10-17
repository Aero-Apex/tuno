import { useQuery } from '@tanstack/react-query';
import { Heart, Library, Link2, Pin, Plus, Search, Shuffle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar } from '../components/Account';
import { Cover } from '../components/Cover';
import { ActionBar, Card, Empty, GradientHeader, Page, PageBar, PlayButton, grid } from '../components/Page';
import { LikedCover } from '../components/Sidebar';
import { usePlaylistMenu } from '../components/PlaylistMenu';
import { TrackList } from '../components/TrackList';
import { api, type Track } from '../lib/api';
import { fmtLong, plural } from '../lib/format';
import { useShallow } from 'zustand/react/shallow';
import { contextSlice, usePlayer } from '../store/player';
import { useAuth } from '../store/auth';
import { useUI } from '../store/ui';

const TABS = [
  { id: 'songs', label: 'Songs' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
] as const;

const SORTS = [
  { id: 'added', label: 'Recently added' },
  { id: 'title', label: 'Title' },
  { id: 'artist', label: 'Artist' },
  { id: 'album', label: 'Album' },
  { id: 'played', label: 'Recently played' },
  { id: 'plays', label: 'Most played' },
  { id: 'duration', label: 'Duration' },
];

/** Play (or pause) the list, and shuffle: the row under every list's header. */
export function PlayAllBar({ tracks, context, extra }: { tracks: Track[]; context: string; extra?: React.ReactNode }) {
  const { context: cur, playing, toggle, playTracks, shuffle, toggleShuffle } = usePlayer(
    useShallow((s) => ({ context: s.context, playing: s.playing, toggle: s.toggle, playTracks: s.playTracks, shuffle: s.shuffle, toggleShuffle: s.toggleShuffle })),
  );
  const isThis = cur === context;
  return (
    <div className="flex items-center gap-5 max-md:flex-1 md:gap-6">
      <PlayButton
        playing={isThis && playing}
        onClick={() => {
          if (isThis) return toggle();
          if (tracks.length) playTracks(tracks, shuffle ? Math.floor(Math.random() * tracks.length) : 0, context);
        }}
        className="max-md:order-last max-md:ml-auto"
      />
      <button
        onClick={toggleShuffle}
        className={`icon-btn relative transition-transform hover:scale-105 ${shuffle ? 'text-accent hover:text-accent' : ''}`}
        title={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
        aria-label="Shuffle"
        aria-pressed={shuffle}
      >
        <Shuffle className="h-7 w-7" />
        {shuffle && <span className="absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />}
      </button>
      {extra}
    </div>
  );
}

function useFilter(tracks: Track[] | undefined, q: string) {
  return useMemo(() => {
    if (!tracks) return [];
    const s = q.trim().toLowerCase();
    if (!s) return tracks;
    return tracks.filter((t) => `${t.title} ${t.artist} ${t.album ?? ''}`.toLowerCase().includes(s));
  }, [tracks, q]);
}

/** A search icon that opens into "Search in playlist" (like Spotify's). */
export function FilterInput({ value, onChange, placeholder = 'Search in list' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(!!value);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="icon-btn hover:bg-text/10" title={placeholder} aria-label={placeholder}>
        <Search className="h-5 w-5" />
      </button>
    );
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => !value && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          onChange('');
          setOpen(false);
        }}
        placeholder={placeholder}
        className="h-8 w-44 rounded bg-text/10 pl-8 pr-2 text-sm text-text outline-none placeholder:text-muted sm:w-56"
      />
    </div>
  );
}

/** On phones the library is Spotify's list (playlists first); on a computer it opens on all your songs. */
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

/** A row in the phone library list: picture, name and a grey line under it. */
function LibraryRow({
  to,
  title,
  subtitle,
  image,
  active,
  pinned,
  onContextMenu,
}: {
  to: string;
  title: string;
  subtitle: React.ReactNode;
  image: React.ReactNode;
  active?: boolean;
  pinned?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <Link to={to} onContextMenu={onContextMenu} className="flex items-center gap-3 rounded-md py-2 active:bg-text/10">
      {image}
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${active ? 'text-accent' : ''}`}>{title}</span>
        <span className="flex items-center gap-1.5 truncate text-sm text-muted">
          {pinned && <Pin className="h-3.5 w-3.5 shrink-0 rotate-45 fill-accent text-accent" />}
          {subtitle}
        </span>
      </span>
    </Link>
  );
}

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as (typeof TABS)[number]['id']) ?? (isPhone() ? 'playlists' : 'songs');
  const [sort, setSort] = useState(() => {
    try {
      return localStorage.getItem('tuno-sort') ?? 'added';
    } catch {
      return 'added';
    }
  });
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const openImport = useUI((s) => s.openImport);
  const playlistMenu = usePlaylistMenu();

  const tracks = useQuery({ queryKey: ['tracks', sort], queryFn: () => api.tracks({ sort }), enabled: tab === 'songs' });
  const liked = useQuery({ queryKey: ['tracks', 'liked'], queryFn: () => api.tracks({ liked: true }), enabled: tab === 'playlists' });
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists, enabled: tab === 'playlists' });
  const albums = useQuery({ queryKey: ['albums'], queryFn: api.albums, enabled: tab === 'albums' });
  const artists = useQuery({ queryKey: ['artists'], queryFn: api.artists, enabled: tab === 'artists' });
  const filtered = useFilter(tracks.data, q);
  const { context, playing, toggle, playTracks } = usePlayer(useShallow(contextSlice));

  const newPlaylist = async () => {
    const p = await api.createPlaylist('New playlist');
    navigate(`/playlist/${p.id}`);
  };

  return (
    <Page bar={<PageBar avatar back={false} solid title="Your Library" />}>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold tracking-tight md:text-3xl md:font-extrabold">Your Library</h1>
        <button onClick={newPlaylist} className="icon-btn text-text md:hidden" aria-label="Create playlist">
          <Plus className="h-7 w-7" />
        </button>
      </div>
      <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setParams({ tab: t.id }, { replace: true })} className={`shrink-0 ${tab === t.id ? 'chip-active' : 'chip'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'songs' &&
        (tracks.data && tracks.data.length === 0 ? (
          <Empty
            icon={<Library className="h-12 w-12" />}
            title="Your library is empty"
            body="Paste a link to a song, album or playlist from YouTube, Spotify, SoundCloud and more — or search and hit download."
            action={
              <button onClick={() => openImport()} className="btn-accent px-8 py-3">
                <Link2 className="h-4 w-4" /> Add from link
              </button>
            }
          />
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <PlayAllBar tracks={tracks.data ?? []} context="library" />
              <div className="flex items-center gap-2">
                <FilterInput value={q} onChange={setQ} placeholder="Search in songs" />
                <select
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    try {
                      localStorage.setItem('tuno-sort', e.target.value);
                    } catch {
                      /* private mode */
                    }
                  }}
                  className="h-8 rounded bg-transparent px-2 text-sm text-muted outline-none hover:text-text"
                  aria-label="Sort"
                >
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mb-3 flex items-center justify-between text-sm text-muted">
              <span>
                {plural(filtered.length, 'song')} · {fmtLong(filtered.reduce((a, t) => a + (t.duration ?? 0), 0))}
              </span>
              <Link to="/settings?tab=storage" className="font-semibold hover:text-text hover:underline">
                Manage &amp; delete songs
              </Link>
            </div>
            <div className="-mx-2 md:mx-0">
              <TrackList tracks={filtered} queueSource={tracks.data} context="library" />
            </div>
          </>
        ))}

      {tab === 'playlists' && (
        <>
          <div className="md:hidden">
            <LibraryRow
              to="/liked"
              title="Liked Songs"
              pinned
              subtitle={`Playlist • ${plural(liked.data?.length ?? 0, 'song')}`}
              image={<LikedCover className="h-16 w-16" icon="h-6 w-6" />}
              active={context === 'liked'}
            />
            {playlists.data?.map((p) => (
              <LibraryRow
                key={p.id}
                to={`/playlist/${p.id}`}
                onContextMenu={playlistMenu.onContextMenu(p)}
                title={p.name}
                subtitle={p.pending ? `${p.pending} downloading` : `Playlist • ${plural(p.count, 'song')}`}
                image={<Cover src={p.cover} mosaic={p.covers} className="h-16 w-16 shrink-0 shadow-none" />}
                active={context === `playlist:${p.id}`}
              />
            ))}
            <button onClick={newPlaylist} className="flex w-full items-center gap-3 py-2 text-left">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-text/10">
                <Plus className="h-7 w-7" />
              </span>
              <span>Create playlist</span>
            </button>
          </div>
          <div className={`${grid} max-md:hidden`}>
            <Card
              onClick={newPlaylist}
              title="New playlist"
              subtitle="Start from scratch"
              coverNode={
                <div className="cover flex aspect-square w-full items-center justify-center bg-elevated">
                  <Plus className="h-12 w-12 text-muted" />
                </div>
              }
            />
            <Card
              to="/liked"
              title="Liked Songs"
              subtitle={`Playlist • ${plural(liked.data?.length ?? 0, 'song')}`}
              coverNode={<LikedCover className="aspect-square h-auto w-full" icon="h-1/3 w-1/3" />}
            />
            {playlists.data?.map((p) => (
              <Card
                key={p.id}
                to={`/playlist/${p.id}`}
                onContextMenu={playlistMenu.onContextMenu(p)}
                cover={p.cover}
                mosaic={p.covers}
                title={p.name}
                subtitle={`Playlist • ${plural(p.count, 'song')}${p.pending ? ` · ${p.pending} downloading` : ''}`}
                playing={context === `playlist:${p.id}` && playing}
                onPlay={async () => {
                  if (context === `playlist:${p.id}`) return toggle();
                  playTracks((await api.playlist(p.id)).tracks, 0, `playlist:${p.id}`);
                }}
              />
            ))}
          </div>
        </>
      )}

      {tab === 'albums' && (
        <>
          {albums.data?.length === 0 && <p className="text-muted">No albums yet. Albums show up when songs have album info.</p>}
          <div className="md:hidden">
            {albums.data?.map((a) => (
              <LibraryRow
                key={a.album}
                to={`/album/${encodeURIComponent(a.album)}`}
                title={a.album}
                subtitle={`Album • ${a.artist}`}
                image={<Cover src={a.cover} className="h-16 w-16 shrink-0 shadow-none" />}
                active={context === `album:${a.album}`}
              />
            ))}
          </div>
          <div className={`${grid} max-md:hidden`}>
            {albums.data?.map((a) => (
              <Card key={a.album} to={`/album/${encodeURIComponent(a.album)}`} cover={a.cover} title={a.album} subtitle={`${a.artist} · ${plural(a.count, 'song')}`} />
            ))}
          </div>
        </>
      )}

      {tab === 'artists' && (
        <>
          <div className="md:hidden">
            {artists.data?.map((a) => (
              <LibraryRow
                key={a.artist}
                to={`/artist/${encodeURIComponent(a.artist)}`}
                title={a.artist}
                subtitle="Artist"
                image={<Cover src={a.cover} round className="h-16 w-16 shrink-0 shadow-none" />}
                active={context === `artist:${a.artist}`}
              />
            ))}
          </div>
          <div className={`${grid} max-md:hidden`}>
            {artists.data?.map((a) => (
              <Card key={a.artist} round to={`/artist/${encodeURIComponent(a.artist)}`} cover={a.cover} title={a.artist} subtitle={`Artist • ${plural(a.count, 'song')}`} />
            ))}
          </div>
        </>
      )}
      {playlistMenu.element}
    </Page>
  );
}

export function LikedPage() {
  const { data: tracks = [] } = useQuery({ queryKey: ['tracks', 'liked'], queryFn: () => api.tracks({ liked: true }) });
  const user = useAuth((s) => s.user);
  const [q, setQ] = useState('');
  const filtered = useFilter(tracks, q);
  const { context, playing, toggle, playTracks } = usePlayer(useShallow(contextSlice));
  return (
    <div className="animate-fade-in pb-10">
      <PageBar
        title="Liked Songs"
        playing={context === 'liked' && playing}
        onPlay={() => (context === 'liked' ? toggle() : tracks.length && playTracks(tracks, 0, 'liked'))}
      />
      <GradientHeader
        kicker="Playlist"
        title="Liked Songs"
        color="#5038a0"
        coverNode={<LikedCover className="h-56 w-56 shadow-[0_4px_60px_rgb(0_0_0/0.5)] md:h-[232px] md:w-[232px]" icon="h-20 w-20" />}
        meta={
          <>
            {user && <Avatar name={user.name} className="mr-1 h-6 w-6 text-xs" />}
            <span className="font-bold">{user?.name}</span>
            <span className="text-text/70">• {plural(tracks.length, 'song')}</span>
          </>
        }
      />
      <ActionBar tint="#5038a0">
        <PlayAllBar tracks={tracks} context="liked" />
        <div className="ml-auto max-md:hidden">
          <FilterInput value={q} onChange={setQ} placeholder="Search in Liked Songs" />
        </div>
      </ActionBar>
      <div className="relative px-2 md:px-4">
        {tracks.length === 0 ? (
          <Empty icon={<Heart className="h-12 w-12" />} title="Songs you like will appear here" body="Save songs by tapping the plus icon." />
        ) : (
          <TrackList tracks={filtered} queueSource={tracks} context="liked" />
        )}
      </div>
    </div>
  );
}
