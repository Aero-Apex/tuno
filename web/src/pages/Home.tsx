import { useQuery } from '@tanstack/react-query';
import { Link2, Search } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cover } from '../components/Cover';
import { Equalizer } from '../components/Equalizer';
import { usePlaylistMenu } from '../components/PlaylistMenu';
import { Card, Page, PageBar, PlayButton, Shelf, shelfItem } from '../components/Page';
import { LikedCover } from '../components/Sidebar';
import { api, type PlaylistSummary, type Track } from '../lib/api';
import { useActions } from '../lib/actions';
import { useCoverColor } from '../lib/color';
import { fmtLong, isUrl, plural } from '../lib/format';
import { setHeaderTint } from '../lib/tint';
import { useShallow } from 'zustand/react/shallow';
import { contextSlice, usePlayer } from '../store/player';

const FILTERS = ['All', 'Music', 'Playlists'] as const;
type Filter = (typeof FILTERS)[number];

function Hero() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const actions = useActions();
  const navigate = useNavigate();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = url.trim();
    if (!v) return;
    if (!isUrl(v)) return navigate(`/search?q=${encodeURIComponent(v)}`);
    setBusy(true);
    try {
      await actions.importUrl(v);
      setUrl('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative mb-8 overflow-hidden rounded-lg p-6 md:p-8" style={{ background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.85), #0d5c2e 70%)' }}>
      <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight text-white md:text-5xl">All your music. One place. Yours forever.</h2>
      <p className="mt-3 max-w-xl text-white/85">
        Paste a link from YouTube, YT Music, Spotify, SoundCloud, Bandcamp and more. Tuno downloads it to your server so you can listen any time.
      </p>
      <form onSubmit={submit} className="mt-6 flex max-w-2xl flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          {isUrl(url) ? (
            <Link2 className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-black" />
          ) : (
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-black/60" />
          )}
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a link or search for a song…"
            className="h-12 w-full rounded-full bg-white pl-12 pr-4 text-black outline-none placeholder:text-black/50 focus:ring-2 focus:ring-black/30"
          />
        </div>
        <button disabled={busy} className="btn h-12 bg-black px-8 text-white hover:scale-105">
          {isUrl(url) ? 'Download' : 'Search'}
        </button>
      </form>
    </div>
  );
}

interface Tile {
  key: string;
  title: string;
  to?: string;
  ctx: string;
  cover?: string | null;
  mosaic?: string[];
  liked?: boolean;
  track?: { list: Track[]; index: number };
  playlist?: PlaylistSummary;
}

/** How many columns of shortcut tiles fit: 2 on phones, 3 in a narrow window, 4 when there's room. */
function useColumns(ref: React.RefObject<HTMLElement | null>) {
  const [cols, setCols] = useState(4);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      setCols(w < 560 ? 2 : w < 980 ? 3 : 4);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}

export function HomePage() {
  const { data } = useQuery({ queryKey: ['home'], queryFn: api.home });
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: api.playlists });
  const { data: artists = [] } = useQuery({ queryKey: ['artists'], queryFn: api.artists, staleTime: 60_000 });
  const { context, playing, playTracks, toggle } = usePlayer(useShallow(contextSlice));
  const currentTrackId = usePlayer((s) => s.queue[s.index]?.track?.id);
  const playlistMenu = usePlaylistMenu();
  const [filter, setFilter] = useState<Filter>('All');
  const gridRef = useRef<HTMLDivElement>(null);
  const cols = useColumns(gridRef);
  const [hovered, setHovered] = useState<Tile | null>(null);

  const playList = (tracks: Track[], ctx: string) => (context === ctx ? toggle() : playTracks(tracks, 0, ctx));
  const recent = data?.recentlyPlayed?.length ? data.recentlyPlayed : data?.recentlyAdded ?? [];

  // Liked Songs and your playlists first, then songs you played lately, like Spotify's shortcuts.
  const tiles: Tile[] = [];
  if (filter !== 'Music') {
    tiles.push({ key: 'liked', title: 'Liked Songs', to: '/liked', ctx: 'liked', liked: true });
    for (const p of [...playlists].sort((a, b) => b.updatedAt - a.updatedAt))
      tiles.push({ key: `p${p.id}`, title: p.name, to: `/playlist/${p.id}`, ctx: `playlist:${p.id}`, cover: p.cover, mosaic: p.covers, playlist: p });
  }
  if (filter !== 'Playlists') recent.forEach((t, i) => tiles.push({ key: `t${t.id}`, title: t.title, ctx: 'home:played', cover: t.cover, track: { list: recent, index: i } }));
  const shown = tiles.slice(0, cols === 2 ? 8 : cols * 2);

  const first = shown[0];
  const colorOf = (t?: Tile | null) => (t ? (t.liked ? null : t.cover ?? t.mosaic?.[0] ?? null) : null);
  const extracted = useCoverColor(colorOf(hovered ?? first));
  const tint = (hovered ?? first)?.liked ? '#5038a0' : extracted;

  useEffect(() => {
    setHeaderTint(tint);
    return () => setHeaderTint(null);
  }, [tint]);

  const trackShelf = (title: string, tracks: Track[] | undefined, ctx: string, kicker?: string) =>
    tracks && tracks.length > 0 ? (
      <Shelf title={title} kicker={kicker}>
        {tracks.map((t, i) => (
          <div key={t.id} className={shelfItem}>
            <Card
              cover={t.cover}
              title={t.title}
              subtitle={t.artist}
              onClick={() => playTracks(tracks, i, ctx)}
              onPlay={() => (context === ctx && currentTrackId === t.id ? toggle() : playTracks(tracks, i, ctx))}
              playing={context === ctx && playing && currentTrackId === t.id}
            />
          </div>
        ))}
      </Shelf>
    ) : null;

  const empty = !!data && data.stats.tracks === 0;
  const hasMusic = !!data && data.stats.tracks > 0;
  const topArtists = [...artists].sort((a, b) => b.count - a.count).slice(0, 12);

  return (
    <Page
      className="!pt-[72px]"
      bar={
        <PageBar avatar back={false} solid>
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(filter === f && f !== 'All' ? 'All' : f)} className={`shrink-0 ${filter === f ? 'chip-active' : 'chip'}`}>
                {f}
              </button>
            ))}
          </div>
        </PageBar>
      }
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[332px] transition-[background-color] duration-700"
        style={{ backgroundColor: tint ?? 'rgb(var(--c-elevated))', backgroundImage: 'linear-gradient(rgb(0 0 0 / 0.6) 0, rgb(var(--c-bg)) 100%)' }}
      />
      <div className="relative">
        {empty && <Hero />}

        <div ref={gridRef}>
          {hasMusic && shown.length > 0 && (
            <div className="mb-6 grid gap-2 md:mb-8" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} onMouseLeave={() => setHovered(null)}>
              {shown.map((t) => (
                <QuickTile
                  key={t.key}
                  tile={t}
                  onHover={() => setHovered(t)}
                  onContextMenu={t.playlist ? playlistMenu.onContextMenu(t.playlist) : undefined}
                  active={t.track ? context === t.ctx && currentTrackId === t.track.list[t.track.index].id : context === t.ctx}
                  playing={playing}
                />
              ))}
            </div>
          )}
        </div>

        {filter !== 'Playlists' && trackShelf('Jump back in', data?.recentlyPlayed, 'home:played', 'Picked up where you left off')}
        {filter !== 'Playlists' && trackShelf('Recently added', data?.recentlyAdded, 'home:added')}
        {filter !== 'Music' && playlists.length > 0 && (
          <Shelf title="Your playlists" to="/library?tab=playlists">
            {playlists.map((p) => (
              <div key={p.id} className={shelfItem}>
                <Card
                  to={`/playlist/${p.id}`}
                  onContextMenu={playlistMenu.onContextMenu(p)}
                  cover={p.cover}
                  mosaic={p.covers}
                  title={p.name}
                  subtitle={`Playlist • ${plural(p.count, 'song')}`}
                  onPlay={async () => {
                    if (context === `playlist:${p.id}`) return toggle();
                    const full = await api.playlist(p.id);
                    playList(full.tracks, `playlist:${p.id}`);
                  }}
                  playing={context === `playlist:${p.id}` && playing}
                />
              </div>
            ))}
          </Shelf>
        )}
        {filter !== 'Playlists' && trackShelf('On repeat', data?.mostPlayed, 'home:top', 'Songs you love right now')}
        {filter !== 'Playlists' && topArtists.length > 0 && (
          <Shelf title="Your top artists" to="/library?tab=artists">
            {topArtists.map((a) => (
              <div key={a.artist} className={shelfItem}>
                <Card
                  to={`/artist/${encodeURIComponent(a.artist)}`}
                  cover={a.cover}
                  round
                  title={a.artist}
                  subtitle="Artist"
                  playing={context === `artist:${a.artist}` && playing}
                  onPlay={async () => {
                    if (context === `artist:${a.artist}`) return toggle();
                    playTracks(await api.tracks({ artist: a.artist, sort: 'plays' }), 0, `artist:${a.artist}`);
                  }}
                />
              </div>
            ))}
          </Shelf>
        )}

        {hasMusic && filter === 'All' && <Hero />}

        {hasMusic && (
          <p className="text-center text-sm text-muted">
            {plural(data.stats.tracks, 'song')} · {plural(data.stats.artists, 'artist')} · {fmtLong(data.stats.seconds)} of music
          </p>
        )}
      </div>
      {playlistMenu.element}
    </Page>
  );
}

function QuickTile({
  tile,
  onHover,
  onContextMenu,
  active,
  playing,
}: {
  tile: Tile;
  onHover: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  active: boolean;
  playing: boolean;
}) {
  const { toggle, playTracks } = usePlayer(useShallow(contextSlice));
  const navigate = useNavigate();
  const isPlaying = active && playing;
  const play = async () => {
    if (active) return toggle();
    if (tile.track) return playTracks(tile.track.list, tile.track.index, tile.ctx);
    const tracks = tile.liked ? await api.tracks({ liked: true }) : (await api.playlist(tile.playlist!.id)).tracks;
    playTracks(tracks, 0, tile.ctx);
  };
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => (tile.to ? navigate(tile.to) : play())}
      onKeyDown={(e) => e.key === 'Enter' && (tile.to ? navigate(tile.to) : play())}
      onMouseEnter={onHover}
      onContextMenu={onContextMenu}
      className="group relative flex h-14 cursor-pointer items-center gap-2 overflow-hidden rounded bg-text/10 pr-2 transition-colors hover:bg-text/20 md:h-12 md:gap-3"
    >
      {tile.liked ? (
        <LikedCover className="h-14 w-14 !rounded-none md:h-12 md:w-12" />
      ) : (
        <Cover src={tile.cover} mosaic={tile.mosaic} className="h-14 w-14 shrink-0 !rounded-none shadow-[0_8px_24px_rgb(0_0_0/0.5)] md:h-12 md:w-12" />
      )}
      <span className="line-clamp-2 flex-1 text-[13px] font-bold leading-tight md:text-sm">{tile.title}</span>
      {isPlaying && <Equalizer className="mr-1 md:hidden" />}
      <PlayButton
        size="sm"
        playing={isPlaying}
        onClick={play}
        className={`!h-8 !w-8 shadow-[0_8px_8px_rgb(0_0_0/0.3)] [&_svg]:!h-4 [&_svg]:!w-4 max-md:hidden ${isPlaying ? '' : 'opacity-0 group-hover:opacity-100'}`}
      />
    </div>
  );
}
