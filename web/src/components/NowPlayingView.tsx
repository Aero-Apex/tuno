import { useQuery } from '@tanstack/react-query';
import { CloudDownload, MoreHorizontal, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useActions } from '../lib/actions';
import { fmtAgo, plural, SOURCE_LABEL } from '../lib/format';
import { useContextName } from '../lib/playContext';
import { itemArtist, itemCover, itemTitle, usePlayer } from '../store/player';
import { useUI } from '../store/ui';
import { Cover } from './Cover';
import { useMenu } from './Menu';
import { QueuePanel } from './QueuePanel';
import { SaveButton } from './PlayerBar';
import { TrackMenu } from './TrackList';

/** The right-hand panel: the playing song (Spotify's "Now Playing view") or the queue. */
export function RightPanel() {
  const panel = useUI((s) => s.rightPanel);
  const hasItem = usePlayer((s) => s.queue.length > 0);
  if (panel === 'queue') return <QueuePanel />;
  if (panel === 'nowplaying' && hasItem) return <NowPlayingView />;
  return null;
}

function NowPlayingView() {
  const item = usePlayer((s) => s.queue[s.index]);
  const next = usePlayer((s) => s.queue[s.index + 1]);
  const nextIndex = usePlayer((s) => s.index + 1);
  const setRightPanel = useUI((s) => s.setRightPanel);
  const ctx = useContextName();
  const navigate = useNavigate();
  const actions = useActions();
  const menu = useMenu();
  const artist = itemArtist(item);
  const { data: artists } = useQuery({ queryKey: ['artists'], queryFn: api.artists, staleTime: 60_000, enabled: !!item?.track });
  const artistInfo = item?.track ? artists?.find((a) => a.artist === artist) : undefined;
  if (!item) return null;
  const track = item.track;

  return (
    <aside className="panel flex h-full w-[300px] shrink-0 flex-col overflow-hidden max-lg:hidden xl:w-[340px] 2xl:w-[400px]">
      <div className="flex h-16 shrink-0 items-center gap-2 px-4">
        {ctx.to ? (
          <Link to={ctx.to} className="min-w-0 flex-1 truncate font-bold hover:underline">
            {ctx.name}
          </Link>
        ) : (
          <span className="min-w-0 flex-1 truncate font-bold">{item.preview ? `Streaming from ${SOURCE_LABEL[item.preview.source] ?? 'the web'}` : ctx.name}</span>
        )}
        {track && (
          <button onClick={menu.open} className="icon-btn hover:bg-text/10" aria-label="More options">
            <MoreHorizontal className="h-5 w-5" />
          </button>
        )}
        <button onClick={() => setRightPanel(null)} className="icon-btn hover:bg-text/10" title="Hide Now Playing view" aria-label="Hide Now Playing view">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <Cover src={itemCover(item)} className="w-full !rounded-lg shadow-[0_8px_24px_rgb(0_0_0/0.5)]" />
        <div className="mt-4 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {track?.album ? (
              <Link to={`/album/${encodeURIComponent(track.album)}`} className="block truncate text-2xl font-bold tracking-tight hover:underline">
                {itemTitle(item)}
              </Link>
            ) : (
              <div className="truncate text-2xl font-bold tracking-tight">{itemTitle(item)}</div>
            )}
            {track ? (
              <Link to={`/artist/${encodeURIComponent(artist)}`} className="block truncate text-muted hover:text-text hover:underline">
                {artist}
              </Link>
            ) : (
              <div className="truncate text-muted">{artist}</div>
            )}
          </div>
          <SaveButton big />
        </div>

        {item.preview && (
          <div className="mt-4 rounded-lg bg-elevated p-4">
            <div className="font-bold">Not in your library yet</div>
            <p className="mt-1 text-sm text-muted">This song is streaming from {SOURCE_LABEL[item.preview.source] ?? 'the web'}. Download it to keep it.</p>
            <button
              onClick={() => actions.importUrl(item.preview!.url).catch(() => {})}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-muted px-4 py-1.5 text-sm font-bold transition-transform hover:scale-105 hover:border-text"
            >
              <CloudDownload className="h-4 w-4" /> Download
            </button>
          </div>
        )}

        {track && (
          <button
            onClick={() => navigate(`/artist/${encodeURIComponent(artist)}`)}
            className="group mt-4 block w-full overflow-hidden rounded-lg bg-elevated text-left"
          >
            <div className="relative">
              <Cover src={artistInfo?.cover ?? track.cover} className="aspect-[4/3] w-full !rounded-none object-cover shadow-none" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
              <span className="absolute left-4 top-4 font-bold">About the artist</span>
            </div>
            <div className="p-4">
              <div className="font-bold group-hover:underline">{artist}</div>
              <div className="mt-1 text-sm text-muted">
                {artistInfo ? `${plural(artistInfo.count, 'song')} in your library` : 'In your library'}
                {track.playCount > 0 && ` · you played this ${plural(track.playCount, 'time')}`}
              </div>
            </div>
          </button>
        )}

        {track && (
          <div className="mt-4 rounded-lg bg-elevated p-4">
            <div className="mb-3 font-bold">Credits</div>
            <Credit label="Artist" value={artist} />
            {track.album && <Credit label="Album" value={track.album} />}
            <Credit label="Source" value={SOURCE_LABEL[track.source] ?? track.source} />
            <Credit label="Added" value={fmtAgo(track.addedAt)} />
          </div>
        )}

        <div className="mt-4 rounded-lg bg-elevated p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-bold">Next in queue</span>
            <button onClick={() => setRightPanel('queue')} className="text-sm font-bold text-muted hover:text-text hover:underline">
              Open queue
            </button>
          </div>
          {next ? (
            <button onClick={() => usePlayer.getState().jumpTo(nextIndex)} className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md p-2 text-left hover:bg-text/10">
              <Cover src={itemCover(next)} className="h-12 w-12 shrink-0 shadow-none" />
              <span className="min-w-0">
                <span className="block truncate">{itemTitle(next)}</span>
                <span className="block truncate text-sm text-muted">{itemArtist(next)}</span>
              </span>
            </button>
          ) : (
            <p className="text-sm text-muted">Nothing up next.</p>
          )}
        </div>
      </div>
      {track && menu.isOpen && <TrackMenu track={track} menuProps={menu.props} />}
    </aside>
  );
}

function Credit({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="truncate">{value}</div>
      <div className="text-sm text-muted">{label}</div>
    </div>
  );
}
