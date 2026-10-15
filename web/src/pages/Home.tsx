import { useQuery } from '@tanstack/react-query';
import { Heart, Link2, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cover } from '../components/Cover';
import { Card, Page, PlayButton, Shelf, shelfItem } from '../components/Page';
import { api, type Track } from '../lib/api';
import { useActions } from '../lib/actions';
import { fmtLong, isUrl, plural } from '../lib/format';
import { useShallow } from 'zustand/react/shallow';
import { contextSlice, usePlayer } from '../store/player';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

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
    <div
      className="relative mb-8 overflow-hidden rounded-xl p-6 md:p-10"
      style={{ background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.35), rgb(var(--c-elevated)) 60%)' }}
    >
      <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight md:text-5xl">All your music. One place. Yours forever.</h2>
      <p className="mt-3 max-w-xl text-text/80">
        Paste a link from YouTube, YT Music, Spotify, SoundCloud, Bandcamp and more. Tuno downloads it to your server so you can listen any time.
      </p>
      <form onSubmit={submit} className="mt-6 flex max-w-2xl flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          {isUrl(url) ? (
            <Link2 className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-accent" />
          ) : (
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          )}
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a link or search for a song…"
            className="h-12 w-full rounded-full bg-bg/80 pl-12 pr-4 text-text outline-none ring-text/30 placeholder:text-muted focus:ring-2"
          />
        </div>
        <button disabled={busy} className="btn-accent h-12 px-6">
          {isUrl(url) ? 'Download' : 'Search'}
        </button>
      </form>
    </div>
  );
}

export function HomePage() {
  const { data } = useQuery({ queryKey: ['home'], queryFn: api.home });
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: api.playlists });
  const { context, playing, playTracks, toggle } = usePlayer(useShallow(contextSlice));
  const currentTrackId = usePlayer((s) => s.queue[s.index]?.track?.id);

  const playList = (tracks: Track[], ctx: string) => (context === ctx ? toggle() : playTracks(tracks, 0, ctx));
  const quick = playlists.slice(0, 7);

  const trackShelf = (title: string, tracks: Track[] | undefined, ctx: string) =>
    tracks && tracks.length > 0 ? (
      <Shelf title={title}>
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

  return (
    <Page>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-80"
        style={{ background: 'linear-gradient(to bottom, rgb(var(--c-dynamic) / 0.35), transparent)' }}
      />
      <div className="relative">
        <h1 className="mb-5 text-3xl font-extrabold tracking-tight">{greeting()}</h1>

        {empty && <Hero />}

        {hasMusic && (
          <div className="mb-8 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <QuickTile to="/liked" title="Liked Songs" icon />
            {quick.map((p) => (
              <QuickTile key={p.id} to={`/playlist/${p.id}`} title={p.name} cover={p.cover} mosaic={p.covers} />
            ))}
          </div>
        )}

        {trackShelf('Jump back in', data?.recentlyPlayed, 'home:played')}
        {trackShelf('Recently added', data?.recentlyAdded, 'home:added')}
        {playlists.length > 0 && (
          <Shelf title="Your playlists" to="/library?tab=playlists">
            {playlists.map((p) => (
              <div key={p.id} className={shelfItem}>
                <Card
                  to={`/playlist/${p.id}`}
                  cover={p.cover}
                  mosaic={p.covers}
                  title={p.name}
                  subtitle={plural(p.count, 'song')}
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
        {trackShelf('On repeat', data?.mostPlayed, 'home:top')}

        {hasMusic && <Hero />}

        {hasMusic && (
          <p className="text-center text-sm text-muted">
            {plural(data.stats.tracks, 'song')} · {plural(data.stats.artists, 'artist')} · {fmtLong(data.stats.seconds)} of music
          </p>
        )}
      </div>
    </Page>
  );
}

function QuickTile({ to, title, cover, mosaic, icon }: { to: string; title: string; cover?: string | null; mosaic?: string[]; icon?: boolean }) {
  const { context, playing, toggle, playTracks } = usePlayer(useShallow(contextSlice));
  const ctx = to === '/liked' ? 'liked' : `playlist:${to.split('/').pop()}`;
  const isPlaying = context === ctx && playing;
  return (
    <Link to={to} className="group relative flex h-16 items-center gap-3 overflow-hidden rounded bg-text/10 pr-3 transition-colors hover:bg-text/20">
      {icon ? (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center bg-gradient-to-br from-accent to-accent/30">
          <Heart className="h-6 w-6 fill-on-accent text-on-accent" />
        </div>
      ) : (
        <Cover src={cover} mosaic={mosaic} className="h-16 w-16 shrink-0 !rounded-none" />
      )}
      <span className="line-clamp-2 flex-1 text-sm font-bold">{title}</span>
      <span onClick={(e) => e.preventDefault()}>
        <PlayButton
          size="md"
          playing={isPlaying}
          className={`h-10 w-10 ${isPlaying ? '' : 'opacity-0 group-hover:opacity-100'} max-md:hidden [&_svg]:h-4 [&_svg]:w-4`}
          onClick={async () => {
            if (context === ctx) return toggle();
            const tracks = ctx === 'liked' ? await api.tracks({ liked: true }) : (await api.playlist(Number(ctx.split(':')[1]))).tracks;
            playTracks(tracks, 0, ctx);
          }}
        />
      </span>
    </Link>
  );
}
