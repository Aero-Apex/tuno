import { useQuery } from '@tanstack/react-query';
import { Heart, Library, Link2, Plus, Search, Shuffle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ActionBar, Card, Empty, GradientHeader, Page, PlayButton, grid } from '../components/Page';
import { TrackList } from '../components/TrackList';
import { api, type Track } from '../lib/api';
import { fmtLong, plural } from '../lib/format';
import { useShallow } from 'zustand/react/shallow';
import { contextSlice, usePlayer } from '../store/player';
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

export function PlayAllBar({ tracks, context, extra }: { tracks: Track[]; context: string; extra?: React.ReactNode }) {
  const { context: cur, playing, toggle, playTracks, shuffle, toggleShuffle } = usePlayer(
    useShallow((s) => ({ context: s.context, playing: s.playing, toggle: s.toggle, playTracks: s.playTracks, shuffle: s.shuffle, toggleShuffle: s.toggleShuffle })),
  );
  const isThis = cur === context;
  return (
    <div className="flex items-center gap-4">
      <PlayButton playing={isThis && playing} onClick={() => (isThis ? toggle() : playTracks(tracks, 0, context))} />
      <button
        onClick={() => {
          if (!shuffle) toggleShuffle();
          playTracks(tracks, Math.floor(Math.random() * tracks.length), context);
        }}
        className={`icon-btn ${shuffle ? 'text-accent hover:text-accent' : ''}`}
        title="Shuffle play"
        aria-label="Shuffle play"
      >
        <Shuffle className="h-7 w-7" />
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

export function FilterInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Filter" className="input w-40 pl-8 sm:w-56" />
    </div>
  );
}

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as (typeof TABS)[number]['id']) ?? 'songs';
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

  const tracks = useQuery({ queryKey: ['tracks', sort], queryFn: () => api.tracks({ sort }), enabled: tab === 'songs' });
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists, enabled: tab === 'playlists' });
  const albums = useQuery({ queryKey: ['albums'], queryFn: api.albums, enabled: tab === 'albums' });
  const artists = useQuery({ queryKey: ['artists'], queryFn: api.artists, enabled: tab === 'artists' });
  const filtered = useFilter(tracks.data, q);
  const { context, playing, toggle, playTracks } = usePlayer(useShallow(contextSlice));

  return (
    <Page>
      <h1 className="mb-5 text-3xl font-extrabold tracking-tight">Your Library</h1>
      <div className="no-scrollbar mb-6 flex gap-2 overflow-x-auto">
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
              <button onClick={() => openImport()} className="btn-accent">
                <Link2 className="h-4 w-4" /> Add from link
              </button>
            }
          />
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <PlayAllBar tracks={filtered} context="library" />
              <div className="flex items-center gap-2">
                <FilterInput value={q} onChange={setQ} />
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
                  className="input w-auto"
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
            <TrackList tracks={filtered} context="library" />
          </>
        ))}

      {tab === 'playlists' && (
        <div className={grid}>
          <Card
            onClick={async () => {
              const p = await api.createPlaylist('New playlist');
              navigate(`/playlist/${p.id}`);
            }}
            title="New playlist"
            subtitle="Start from scratch"
            cover={null}
            badge={<Plus className="h-6 w-6" />}
          />
          <Card to="/liked" title="Liked Songs" subtitle="Your favorites" cover={null} badge={<Heart className="h-6 w-6 fill-accent text-accent" />} />
          {playlists.data?.map((p) => (
            <Card
              key={p.id}
              to={`/playlist/${p.id}`}
              cover={p.cover}
              mosaic={p.covers}
              title={p.name}
              subtitle={`${plural(p.count, 'song')}${p.pending ? ` · ${p.pending} downloading` : ''}`}
              playing={context === `playlist:${p.id}` && playing}
              onPlay={async () => {
                if (context === `playlist:${p.id}`) return toggle();
                playTracks((await api.playlist(p.id)).tracks, 0, `playlist:${p.id}`);
              }}
            />
          ))}
        </div>
      )}

      {tab === 'albums' && (
        <div className={grid}>
          {albums.data?.length === 0 && <p className="col-span-full px-3 text-muted">No albums yet. Albums show up when songs have album info.</p>}
          {albums.data?.map((a) => (
            <Card key={a.album} to={`/album/${encodeURIComponent(a.album)}`} cover={a.cover} title={a.album} subtitle={`${a.artist} · ${plural(a.count, 'song')}`} />
          ))}
        </div>
      )}

      {tab === 'artists' && (
        <div className={grid}>
          {artists.data?.map((a) => (
            <Card key={a.artist} round to={`/artist/${encodeURIComponent(a.artist)}`} cover={a.cover} title={a.artist} subtitle={plural(a.count, 'song')} />
          ))}
        </div>
      )}
    </Page>
  );
}

export function LikedPage() {
  const { data: tracks = [] } = useQuery({ queryKey: ['tracks', 'liked'], queryFn: () => api.tracks({ liked: true }) });
  const [q, setQ] = useState('');
  const filtered = useFilter(tracks, q);
  return (
    <div className="animate-fade-in pb-10">
      <GradientHeader
        kicker="Playlist"
        title="Liked Songs"
        color="rgb(var(--c-accent) / 0.55)"
        coverNode={
          <div className="cover flex h-48 w-48 shrink-0 items-center justify-center bg-gradient-to-br from-accent to-accent/20 shadow-2xl md:h-56 md:w-56">
            <Heart className="h-20 w-20 fill-on-accent text-on-accent" />
          </div>
        }
        meta={<span>{plural(tracks.length, 'song')} · {fmtLong(tracks.reduce((a, t) => a + (t.duration ?? 0), 0))}</span>}
      />
      <ActionBar tint="rgb(var(--c-accent))">
        <PlayAllBar tracks={filtered} context="liked" />
        <div className="ml-auto">
          <FilterInput value={q} onChange={setQ} />
        </div>
      </ActionBar>
      <div className="px-2 md:px-4">
        {tracks.length === 0 ? (
          <Empty icon={<Heart className="h-12 w-12" />} title="Songs you like will appear here" body="Tap the heart on any song to save it here." />
        ) : (
          <TrackList tracks={filtered} context="liked" />
        )}
      </div>
    </div>
  );
}
