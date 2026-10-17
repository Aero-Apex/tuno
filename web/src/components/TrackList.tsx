import { useQuery } from '@tanstack/react-query';
import {
  Clock3,
  Disc3,
  EllipsisVertical,
  ExternalLink,
  Heart,
  ListEnd,
  ListPlus,
  ListStart,
  MinusCircle,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Trash2,
  UserRound,
} from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Track } from '../lib/api';
import { useActions } from '../lib/actions';
import { fmtAgo, fmtTime } from '../lib/format';
import { fromTrack, usePlayer } from '../store/player';
import { useUI } from '../store/ui';
import { Cover } from './Cover';
import { Menu, useMenu, type MenuItem } from './Menu';
import { Equalizer } from './Equalizer';
import { LikeButton } from './PlayerBar';

interface Props {
  tracks: Track[];
  /** The whole list when `tracks` is a filtered view of it, so playing a row keeps the rest of the list queued. */
  queueSource?: Track[];
  context: string;
  playlistId?: number;
  showAlbum?: boolean;
  showAdded?: boolean;
  reorderable?: boolean;
  onReorder?: (ids: number[]) => void;
}

export function TrackList({ tracks, queueSource, context, playlistId, showAlbum = true, showAdded = true, reorderable, onReorder }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const pinned = usePinned(sentinel);

  const cols = `grid-cols-[minmax(0,1fr)_2.5rem] md:grid-cols-[2rem_minmax(0,1fr)_2.5rem_3.5rem_2rem] ${
    showAlbum ? 'md:grid-cols-[2rem_minmax(0,4fr)_minmax(0,3fr)_2.5rem_3.5rem_2rem]' : ''
  } ${showAlbum && showAdded ? 'xl:grid-cols-[2rem_minmax(0,4fr)_minmax(0,3fr)_minmax(0,2fr)_2.5rem_3.5rem_2rem]' : ''}`;

  return (
    <div className="select-none" role="table">
      <div ref={sentinel} className="h-px" />
      <div
        className={`sticky top-16 z-20 -mx-2 mb-2 px-2 transition-colors max-md:hidden md:-mx-4 md:px-4 ${pinned ? 'border-b border-text/10 bg-[#1a1a1a]' : ''}`}
      >
        <div className={`grid ${cols} h-9 items-center gap-3 border-b px-3 text-sm text-muted ${pinned ? 'border-transparent' : 'border-text/10'}`}>
          <span className="text-center">#</span>
          <span>Title</span>
          {showAlbum && <span className="hidden md:block">Album</span>}
          {showAlbum && showAdded && <span className="hidden xl:block">Date added</span>}
          <span />
          <Clock3 className="h-4 w-4 justify-self-end" />
          <span />
        </div>
      </div>
      <div>
        {tracks.map((t, i) => (
          <div
            key={t.id}
            draggable={reorderable}
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              setDragOver(i);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
            onDrop={() => {
              if (dragFrom === null || dragFrom === i) return;
              const ids = tracks.map((x) => x.id);
              const [moved] = ids.splice(dragFrom, 1);
              ids.splice(i, 0, moved);
              onReorder?.(ids);
            }}
            className={dragOver === i && dragFrom !== null ? 'border-t-2 border-accent' : 'border-t-2 border-transparent'}
          >
            <TrackRow track={t} index={i} tracks={queueSource ?? tracks} context={context} playlistId={playlistId} cols={cols} showAlbum={showAlbum} showAdded={showAdded} />
          </div>
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  track: Track;
  index: number;
  tracks: Track[];
  context: string;
  playlistId?: number;
  cols: string;
  showAlbum: boolean;
  showAdded: boolean;
}

const TrackRow = memo(function TrackRow({ track: t, index, tracks, context, playlistId, cols, showAlbum, showAdded }: RowProps) {
  const isCurrent = usePlayer((s) => s.queue[s.index]?.track?.id === t.id);
  const playing = usePlayer((s) => s.playing);
  const actions = useActions();
  const menu = useMenu();

  const play = () => {
    const p = usePlayer.getState();
    if (isCurrent) return p.toggle();
    // `tracks` is the whole list here, so start at this song's place in it.
    p.playTracks(tracks, Math.max(0, tracks.findIndex((x) => x.id === t.id)), context);
  };

  return (
    <div
      role="row"
      onDoubleClick={play}
      onContextMenu={menu.open}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto var(--row-h)' }}
      className={`group grid ${cols} h-row items-center gap-3 rounded px-2 text-sm transition-colors hover:bg-text/10 md:px-3 ${menu.isOpen ? 'bg-text/10' : ''}`}
    >
      <button onClick={play} className="hidden items-center justify-center text-base text-muted md:flex" aria-label={`Play ${t.title}`}>
        <span className={`tabular-nums group-hover:hidden ${isCurrent ? 'text-accent' : ''}`}>
          {isCurrent && playing ? <Equalizer /> : index + 1}
        </span>
        <Play className="hidden h-4 w-4 fill-current text-text group-hover:block" />
      </button>
      <div className="flex min-w-0 items-center gap-3" onClick={() => window.matchMedia('(max-width: 767px)').matches && play()}>
        <Cover src={t.cover} className="h-12 w-12 shrink-0 shadow-none md:h-10 md:w-10" />
        <div className="min-w-0">
          <div className={`truncate text-base ${isCurrent ? 'text-accent' : 'text-text'}`}>{t.title}</div>
          <ArtistLink artist={t.artist} />
        </div>
      </div>
      {showAlbum && (
        <div className="hidden truncate text-muted md:block">
          {t.album ? <AlbumLink album={t.album} /> : <span className="opacity-60">—</span>}
        </div>
      )}
      {showAlbum && showAdded && <div className="hidden truncate text-muted xl:block">{fmtAgo(t.addedAt)}</div>}
      <span className="justify-self-center max-md:hidden">
        <LikeButton liked={t.liked} reveal onClick={() => actions.toggleLike(t)} />
      </span>
      <span className="justify-self-end tabular-nums text-muted max-md:hidden">{fmtTime(t.duration)}</span>
      <button onClick={menu.open} className="icon-btn opacity-0 group-hover:opacity-100 max-md:opacity-100" aria-label="More options">
        <MoreHorizontal className="h-5 w-5 max-md:hidden" />
        <EllipsisVertical className="h-5 w-5 md:hidden" />
      </button>
      {menu.isOpen && <TrackMenu track={t} playlistId={playlistId} menuProps={menu.props} />}
    </div>
  );
});

/** True once the element has scrolled up under the page's sticky bar, so the column headings can turn solid. */
function usePinned(ref: React.RefObject<HTMLElement | null>) {
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    const el = ref.current;
    const root = document.getElementById('main-view');
    if (!el || !root) return;
    const io = new IntersectionObserver(([e]) => setPinned(!e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0)), {
      root,
      rootMargin: '-64px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return pinned;
}

function ArtistLink({ artist }: { artist: string }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/artist/${encodeURIComponent(artist)}`);
      }}
      className="block max-w-full truncate text-left text-muted hover:text-text hover:underline"
    >
      {artist}
    </button>
  );
}

function AlbumLink({ album }: { album: string }) {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(`/album/${encodeURIComponent(album)}`)} className="max-w-full truncate hover:text-text hover:underline">
      {album}
    </button>
  );
}

export function TrackMenu({
  track: t,
  playlistId,
  menuProps,
}: {
  track: Track;
  playlistId?: number;
  menuProps: (items: MenuItem[]) => React.ComponentProps<typeof Menu>;
}) {
  const actions = useActions();
  const navigate = useNavigate();
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: api.playlists });
  const items: MenuItem[] = [
    { label: 'Play next', icon: <ListStart className="h-4 w-4" />, onClick: () => usePlayer.getState().playNext([fromTrack(t)]) },
    { label: 'Add to queue', icon: <ListEnd className="h-4 w-4" />, onClick: () => usePlayer.getState().addToQueue([fromTrack(t)]) },
    {
      label: 'Add to playlist',
      icon: <ListPlus className="h-4 w-4" />,
      submenu: [
        { label: 'New playlist', icon: <Plus className="h-4 w-4" />, onClick: () => actions.newPlaylistWith([t]) },
        ...(playlists.length ? [{ label: '', divider: true }] : []),
        ...playlists.filter((p) => p.id !== playlistId).map((p) => ({ label: p.name, onClick: () => actions.addToPlaylist(p.id, [t], p.name) })),
      ],
    },
    ...(playlistId
      ? [{ label: 'Remove from this playlist', icon: <MinusCircle className="h-4 w-4" />, onClick: () => actions.removeFromPlaylist(playlistId, t) }]
      : []),
    { label: t.liked ? 'Remove from Liked Songs' : 'Save to Liked Songs', icon: <Heart className="h-4 w-4" />, onClick: () => actions.toggleLike(t) },
    { label: '', divider: true },
    { label: 'Go to artist', icon: <UserRound className="h-4 w-4" />, onClick: () => navigate(`/artist/${encodeURIComponent(t.artist)}`) },
    ...(t.album ? [{ label: 'Go to album', icon: <Disc3 className="h-4 w-4" />, onClick: () => navigate(`/album/${encodeURIComponent(t.album!)}`) }] : []),
    { label: 'Open original', icon: <ExternalLink className="h-4 w-4" />, onClick: () => window.open(t.sourceUrl, '_blank', 'noopener') },
    { label: 'Edit details', icon: <Pencil className="h-4 w-4" />, onClick: () => useUI.getState().setEditing(t) },
    { label: '', divider: true },
    { label: 'Delete from library', icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => actions.deleteTrack(t) },
  ];
  return <Menu {...menuProps(items)} />;
}
