import { useQuery } from '@tanstack/react-query';
import { Check, CloudDownload, ExternalLink, ListEnd, ListStart, Loader2, MoreHorizontal, Play, SearchX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Cover } from '../components/Cover';
import { Equalizer } from '../components/Equalizer';
import { Menu, useMenu } from '../components/Menu';
import { Card, Empty, grid, Page, PageBar, Shelf, shelfItem } from '../components/Page';
import { SearchBox } from '../components/TopBar';
import { api, type SearchResult, type SearchSource } from '../lib/api';
import { useActions } from '../lib/actions';
import { fmtTime, SOURCE_COLOR, SOURCE_LABEL } from '../lib/format';
import { fromResult, fromTrack, usePlayer } from '../store/player';
import { useUI } from '../store/ui';

type Tab = 'all' | 'playlists' | SearchSource;
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'ytmusic', label: 'YT Music' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'soundcloud', label: 'SoundCloud' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'library', label: 'Your library' },
];

function useRecent() {
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('tuno-recent-searches') ?? '[]');
    } catch {
      return [];
    }
  });
  const save = (list: string[]) => {
    setRecent(list);
    try {
      localStorage.setItem('tuno-recent-searches', JSON.stringify(list));
    } catch {
      /* ignore */
    }
  };
  return {
    recent,
    add: (q: string) => save([q, ...recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 12)),
    remove: (q: string) => save(recent.filter((r) => r !== q)),
  };
}

function useSource(q: string, source: SearchSource, enabled = true) {
  return useQuery({
    queryKey: ['search', source, q],
    queryFn: () => api.search(q, source),
    enabled: !!q && enabled,
    staleTime: 5 * 60_000,
  });
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const tab = (params.get('tab') as Tab) ?? 'all';
  const { recent, add, remove } = useRecent();
  const navigate = useNavigate();

  // Only remember a search once it has settled (the search box updates the URL while you type).
  useEffect(() => {
    if (!q) return;
    const t = setTimeout(() => add(q), 2500);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!q) {
    return (
      <Page bar={<PageBar avatar back={false} solid />}>
        <h1 className="mb-4 text-2xl font-bold tracking-tight md:hidden">Search</h1>
        <div className="mb-6 md:hidden">
          <SearchBox variant="page" />
        </div>
        {recent.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-2xl font-bold tracking-tight">Recent searches</h2>
            <div className="flex flex-wrap gap-2">
              {recent.map((r) => (
                <span key={r} className="chip gap-1.5 pr-1.5">
                  <button onClick={() => navigate(`/search?q=${encodeURIComponent(r)}`)}>{r}</button>
                  <button onClick={() => remove(r)} className="rounded-full p-0.5 text-muted hover:text-text" aria-label={`Remove ${r}`}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          </section>
        )}
        <BrowseAll />
      </Page>
    );
  }

  return (
    <Page bar={<PageBar back={false} solid />}>
      <div className="mb-4 md:hidden">
        <SearchBox variant="page" />
      </div>
      <div className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setParams({ q, ...(t.id === 'all' ? {} : { tab: t.id }) }, { replace: true })}
            className={`shrink-0 ${tab === t.id ? 'chip-active' : 'chip'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'all' ? <AllResults q={q} /> : tab === 'playlists' ? <PlaylistResults q={q} /> : <SourceResults q={q} source={tab} />}
    </Page>
  );
}

/** Colors for the Browse cards, in the spirit of Spotify's category tiles. */
const BROWSE_COLORS = ['#dc148c', '#006450', '#8400e7', '#1e3264', '#e8115b', '#477d95', '#e91429', '#503750', '#b06239', '#0d73ec', '#148a08', '#7358ff'];

function BrowseCard({ title, color, image, onClick, round }: { title: string; color: string; image?: string | null; onClick: () => void; round?: boolean }) {
  return (
    <button onClick={onClick} className="relative aspect-[16/9] overflow-hidden rounded-lg p-3 text-left md:aspect-square md:p-4" style={{ background: color }}>
      <span className="relative z-10 line-clamp-2 break-words text-base font-bold text-white md:text-2xl md:tracking-tight">{title}</span>
      {image && (
        <Cover src={image} round={round} className="absolute -bottom-1 -right-3 h-[52%] w-auto rotate-[25deg] shadow-[0_2px_4px_rgb(0_0_0/0.2)] md:h-[45%]" />
      )}
    </button>
  );
}

/** The search page before you type: shortcuts into your library and its artists and albums, as colored tiles. */
function BrowseAll() {
  const navigate = useNavigate();
  const { data: artists = [] } = useQuery({ queryKey: ['artists'], queryFn: api.artists, staleTime: 60_000 });
  const { data: albums = [] } = useQuery({ queryKey: ['albums'], queryFn: api.albums, staleTime: 60_000 });
  const { data: home } = useQuery({ queryKey: ['home'], queryFn: api.home });
  const cover = (i: number) => home?.recentlyAdded?.[i]?.cover ?? artists[i]?.cover ?? null;
  const focus = () => window.dispatchEvent(new Event('tuno:focus-search'));
  const fixed = [
    { title: 'Liked Songs', onClick: () => navigate('/liked'), image: cover(0) },
    { title: 'Your Library', onClick: () => navigate('/library'), image: cover(1) },
    { title: 'Downloads', onClick: () => navigate('/downloads'), image: cover(2) },
    { title: 'YT Music', onClick: focus, image: cover(3) },
    { title: 'YouTube', onClick: focus, image: cover(4) },
    { title: 'SoundCloud', onClick: focus, image: cover(5) },
  ];
  const top = [...artists].sort((a, b) => b.count - a.count).slice(0, 12);
  const topAlbums = [...albums].sort((a, b) => b.count - a.count).slice(0, 6);
  const color = (i: number) => BROWSE_COLORS[i % BROWSE_COLORS.length];
  return (
    <section>
      <h2 className="mb-4 text-base font-bold md:text-2xl md:tracking-tight">Browse all</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {fixed.map((c, i) => (
          <BrowseCard key={c.title} title={c.title} color={color(i)} image={c.image} onClick={c.onClick} />
        ))}
        {top.map((a, i) => (
          <BrowseCard key={'a' + a.artist} title={a.artist} round color={color(i + fixed.length)} image={a.cover} onClick={() => navigate(`/artist/${encodeURIComponent(a.artist)}`)} />
        ))}
        {topAlbums.map((a, i) => (
          <BrowseCard
            key={'l' + a.album}
            title={a.album}
            color={color(i + fixed.length + top.length)}
            image={a.cover}
            onClick={() => navigate(`/album/${encodeURIComponent(a.album)}`)}
          />
        ))}
      </div>
      <p className="mt-8 max-w-xl text-sm text-muted">
        Search YouTube Music, YouTube, SoundCloud and your own library at once, or paste any link (Spotify too) in the search bar to download it.
      </p>
    </section>
  );
}
function AllResults({ q }: { q: string }) {
  const ytm = useSource(q, 'ytmusic');
  const lib = useSource(q, 'library');
  const yt = useSource(q, 'youtube');
  const sc = useSource(q, 'soundcloud');
  const [, setParams] = useSearchParams();
  const songs = ytm.data?.filter((r) => r.kind === 'track') ?? [];
  const albums = ytm.data?.filter((r) => r.kind === 'album') ?? [];
  // Library results also hold playlists; the songs section and the top result only use songs.
  const libTracks = lib.data?.filter((r) => r.kind === 'track') ?? [];
  const playlists = [...(lib.data ?? []), ...(ytm.data ?? [])].filter((r) => r.kind === 'playlist');
  const actions = useActions();
  const top = libTracks[0] ?? songs[0];

  const section = (title: string, source: SearchSource, data: SearchResult[] | undefined, loading: boolean, error: unknown) => (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          {title}
          {loading && <Loader2 className="h-5 w-5 animate-spin text-muted" />}
        </h2>
        {(data?.length ?? 0) > 5 && (
          <button onClick={() => setParams({ q, tab: source }, { replace: true })} className="text-sm font-semibold text-muted hover:text-text hover:underline">
            Show all
          </button>
        )}
      </div>
      {error ? (
        <p className="text-sm text-red-400">{(error as Error).message}</p>
      ) : loading ? (
        <SkeletonRows n={4} />
      ) : data && data.length ? (
        <ResultList results={data.slice(0, 5)} />
      ) : (
        <p className="text-sm text-muted">No results.</p>
      )}
    </section>
  );

  return (
    <div>
      <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section>
          <h2 className="mb-3 text-2xl font-bold tracking-tight">Top result</h2>
          {top ? <TopResult r={top} /> : <div className="h-56 animate-pulse rounded-lg bg-text/5" />}
        </section>
        {section('Songs', 'ytmusic', songs, ytm.isLoading, ytm.error)}
      </div>
      {libTracks.length > 0 && section('In your library', 'library', libTracks, lib.isLoading, lib.error)}
      {albums.length > 0 && (
        <Shelf title="Albums">
          {albums.map((a) => (
            <div key={a.key} className={shelfItem}>
              <Card
                cover={a.thumbnail}
                title={a.title}
                subtitle={`${a.album ? a.album + ' · ' : ''}${a.artist}`}
                onClick={() => actions.importUrl(a.url)}
                badge={
                  <span className="flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-xs font-semibold text-white">
                    <CloudDownload className="h-3.5 w-3.5" /> Download album
                  </span>
                }
              />
            </div>
          ))}
        </Shelf>
      )}
      {playlists.length > 0 && (
        <Shelf title="Playlists">
          {playlists.map((p) => (
            <div key={p.key} className={shelfItem}>
              <PlaylistCard r={p} />
            </div>
          ))}
        </Shelf>
      )}
      {section('YouTube', 'youtube', yt.data, yt.isLoading, yt.error)}
      {section('SoundCloud', 'soundcloud', sc.data, sc.isLoading, sc.error)}
    </div>
  );
}

function SourceResults({ q, source }: { q: string; source: SearchSource }) {
  const { data, isLoading, error } = useSource(q, source);
  const actions = useActions();
  if (isLoading) return <SkeletonRows n={10} />;
  if (error) return <p className="text-sm text-red-400">{(error as Error).message}</p>;
  if (!data?.length) return <Empty icon={<SearchX className="h-12 w-12" />} title={`No results for “${q}”`} body="Try different words, or paste a link." />;
  const tracks = data.filter((r) => r.kind === 'track');
  const albums = data.filter((r) => r.kind === 'album');
  const playlists = data.filter((r) => r.kind === 'playlist');
  return (
    <div>
      <ResultList results={tracks} />
      {albums.length > 0 && (
        <div className="mt-10">
          <Shelf title="Albums">
            {albums.map((a) => (
              <div key={a.key} className={shelfItem}>
                <Card cover={a.thumbnail} title={a.title} subtitle={a.artist} onClick={() => actions.importUrl(a.url)} />
              </div>
            ))}
          </Shelf>
        </div>
      )}
      {playlists.length > 0 && (
        <div className="mt-10">
          <Shelf title="Playlists">
            {playlists.map((p) => (
              <div key={p.key} className={shelfItem}>
                <PlaylistCard r={p} />
              </div>
            ))}
          </Shelf>
        </div>
      )}
    </div>
  );
}

/** Playlists from YT Music, your library and Spotify. Spotify only shows up once its keys are saved. */
function PlaylistResults({ q }: { q: string }) {
  const ytm = useSource(q, 'ytmusic');
  const lib = useSource(q, 'library');
  const sp = useSource(q, 'spotify');
  const lists = [...(lib.data ?? []), ...(ytm.data ?? []), ...(sp.data ?? [])].filter((r) => r.kind === 'playlist');
  if (!lists.length && (ytm.isLoading || lib.isLoading || sp.isLoading)) return <SkeletonRows n={6} />;
  return (
    <div>
      {sp.error && <p className="mb-4 text-sm text-muted">{(sp.error as Error).message}</p>}
      {lists.length > 0 ? (
        <div className={grid}>
          {lists.map((r) => (
            <PlaylistCard key={r.key} r={r} />
          ))}
        </div>
      ) : (
        <Empty icon={<SearchX className="h-12 w-12" />} title={`No playlists for “${q}”`} body="Try different words, or paste a playlist link." />
      )}
    </div>
  );
}

/** A playlist card. Library playlists open; online ones download to your library. */
function PlaylistCard({ r }: { r: SearchResult }) {
  const actions = useActions();
  const navigate = useNavigate();
  const fromLibrary = r.source === 'library';
  return (
    <Card
      cover={r.thumbnail}
      title={r.title}
      subtitle={`${SOURCE_LABEL[r.source] ?? r.source} · ${r.artist}`}
      onClick={() => (fromLibrary ? navigate(r.url) : actions.importUrl(r.url))}
      badge={
        fromLibrary ? undefined : (
          <span className="flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-xs font-semibold text-white">
            <CloudDownload className="h-3.5 w-3.5" /> Download playlist
          </span>
        )
      }
    />
  );
}

function TopResult({ r }: { r: SearchResult }) {
  const play = usePlay();
  return (
    <div className="group relative rounded-lg bg-[#181818] p-5 transition-colors hover:bg-[#282828]">
      <Cover src={r.thumbnail} className="mb-5 h-24 w-24 shadow-xl" />
      <div className="truncate text-3xl font-extrabold tracking-tight">{r.title}</div>
      <div className="mt-1 flex items-center gap-2 text-sm text-muted">
        <span className="truncate">{r.artist}</span>
        <SourceBadge source={r.trackId ? 'library' : r.source} />
      </div>
      <button
        onClick={() => play([r], 0)}
        className="absolute bottom-5 right-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-accent opacity-0 shadow-xl transition-all group-hover:opacity-100 max-md:opacity-100"
        aria-label="Play"
      >
        <Play className="h-6 w-6 translate-x-0.5 fill-current" />
      </button>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
      style={{ background: SOURCE_COLOR[source] ?? '#666' }}
    >
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}

/** Plays search results: library tracks from disk, everything else streamed from the source. */
function usePlay() {
  return async (results: SearchResult[], index: number) => {
    const items = await Promise.all(
      results.map(async (r) => (r.trackId ? fromTrack(await api.track(r.trackId)) : fromResult(r))),
    ).catch(() => results.map(fromResult));
    usePlayer.getState().playItems(items.filter((i) => i.track || i.preview), index, null);
  };
}

function ResultList({ results }: { results: SearchResult[] }) {
  const play = usePlay();
  return (
    <div>
      {results.map((r, i) => (
        <ResultRow key={r.key} r={r} onPlay={() => play(results, i)} />
      ))}
    </div>
  );
}

function ResultRow({ r, onPlay }: { r: SearchResult; onPlay: () => void }) {
  const actions = useActions();
  const pending = useUI((s) => s.pendingKeys.has(r.key));
  const isCurrent = usePlayer((s) => {
    const cur = s.queue[s.index];
    return (!!r.trackId && cur?.track?.id === r.trackId) || cur?.preview?.url === r.url;
  });
  const playing = usePlayer((s) => s.playing);
  const menu = useMenu();
  const owned = !!r.trackId;
  // Spotify tracks can't be streamed, so their row opens the Spotify page instead of playing.
  const streamable = r.source !== 'spotify';
  const hoverTimer = useRef<number>(undefined);

  return (
    <div
      onDoubleClick={streamable ? onPlay : undefined}
      onContextMenu={menu.open}
      onPointerEnter={() => {
        if (owned) return;
        hoverTimer.current = window.setTimeout(() => api.warmPreview(r.url), 250);
      }}
      onPointerLeave={() => clearTimeout(hoverTimer.current)}
      className={`group flex h-row items-center gap-3 rounded px-2 transition-colors hover:bg-text/10 ${menu.isOpen ? 'bg-text/10' : ''}`}
    >
      <button
        onClick={() => (!streamable ? window.open(r.url, '_blank', 'noopener') : isCurrent ? usePlayer.getState().toggle() : onPlay())}
        className="relative shrink-0"
        aria-label={`Play ${r.title}`}
      >
        <Cover src={r.thumbnail} className="h-10 w-10 shadow-none" />
        <span className={`cover absolute inset-0 items-center justify-center bg-black/50 ${isCurrent ? 'flex' : 'hidden group-hover:flex'}`}>
          {isCurrent && playing ? <Equalizer /> : <Play className="h-4 w-4 fill-white text-white" />}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-medium ${isCurrent ? 'text-accent' : ''}`}>{r.title}</div>
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="truncate">{r.artist}</span>
          {r.album && r.source === 'ytmusic' && <span className="hidden truncate lg:inline">· {r.album}</span>}
        </div>
      </div>
      <SourceBadge source={owned && r.source !== 'library' ? 'library' : r.source} />
      <span className="hidden w-12 text-right text-sm tabular-nums text-muted sm:block">{fmtTime(r.duration)}</span>
      {owned ? (
        <span className="flex h-9 w-9 items-center justify-center text-accent" title="In your library">
          <Check className="h-5 w-5" />
        </span>
      ) : (
        <button
          onClick={() => actions.downloadResult(r).catch(() => {})}
          disabled={pending}
          className={`icon-btn h-9 w-9 ${pending ? 'text-accent' : ''}`}
          title="Download to library"
          aria-label="Download to library"
        >
          {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <CloudDownload className="h-5 w-5" />}
        </button>
      )}
      <button onClick={menu.open} className="icon-btn opacity-0 group-hover:opacity-100 max-md:opacity-100" aria-label="More">
        <MoreHorizontal className="h-5 w-5" />
      </button>
      <Menu
        {...menu.props([
          ...(streamable
            ? [
                { label: 'Play next', icon: <ListStart className="h-4 w-4" />, onClick: () => usePlayer.getState().playNext([fromResult(r)]) },
                { label: 'Add to queue', icon: <ListEnd className="h-4 w-4" />, onClick: () => usePlayer.getState().addToQueue([fromResult(r)]) },
              ]
            : []),
          ...(owned ? [] : [{ label: 'Download to library', icon: <CloudDownload className="h-4 w-4" />, onClick: () => actions.downloadResult(r).catch(() => {}) }]),
          { label: 'Open original', icon: <ExternalLink className="h-4 w-4" />, onClick: () => window.open(r.url, '_blank', 'noopener') },
        ])}
      />
    </div>
  );
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex h-row items-center gap-3 px-2">
          <div className="cover h-10 w-10 animate-pulse bg-text/10" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/2 animate-pulse rounded bg-text/10" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-text/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
