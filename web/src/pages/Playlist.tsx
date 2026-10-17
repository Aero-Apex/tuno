import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ImagePlus, Link2, ListMusic, Loader2, MoreHorizontal, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Cover } from '../components/Cover';
import { Modal, readImage } from '../components/Dialogs';
import { Menu, useMenu } from '../components/Menu';
import { Avatar } from '../components/Account';
import { ActionBar, Empty, GradientHeader, PageBar } from '../components/Page';
import { TrackList } from '../components/TrackList';
import { api } from '../lib/api';
import { useCoverColor } from '../lib/color';
import { fmtLong, plural } from '../lib/format';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '../store/auth';
import { contextSlice, usePlayer } from '../store/player';
import { useUI } from '../store/ui';
import { FilterInput, PlayAllBar } from './Library';

export function PlaylistPage() {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const { data: p, isError } = useQuery({ queryKey: ['playlist', id], queryFn: () => api.playlist(id) });
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const menu = useMenu();
  const { openImport, toast, ask } = useUI();
  const navigate = useNavigate();
  const tint = useCoverColor(p?.cover ?? p?.covers[0]);
  const user = useAuth((s) => s.user);
  const { context, playing, toggle, playTracks } = usePlayer(useShallow(contextSlice));

  if (isError) return <Empty icon={<ListMusic className="h-12 w-12" />} title="Playlist not found" />;
  if (!p) return <div className="h-96" />;

  const filtered = q ? p.tracks.filter((t) => `${t.title} ${t.artist} ${t.album ?? ''}`.toLowerCase().includes(q.toLowerCase())) : p.tracks;

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.syncPlaylist(id);
      toast(r.queued ? `Found ${plural(r.queued, 'new song')} — downloading` : 'Already up to date', 'success');
      qc.invalidateQueries({ queryKey: ['jobs'] });
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const remove = () =>
    ask({
      title: `Delete “${p.name}”?`,
      body: 'The playlist is removed. Songs stay in your library unless you choose to delete them too.',
      confirmLabel: 'Delete playlist',
      danger: true,
      onConfirm: async () => {
        await api.deletePlaylist(id, false);
        qc.invalidateQueries({ queryKey: ['playlists'] });
        navigate('/library?tab=playlists');
      },
    });

  return (
    <div className="animate-fade-in pb-10">
      <PageBar
        title={p.name}
        playing={context === `playlist:${p.id}` && playing}
        onPlay={() => (context === `playlist:${p.id}` ? toggle() : p.tracks.length && playTracks(p.tracks, 0, `playlist:${p.id}`))}
      />
      <GradientHeader
        cover={p.cover}
        mosaic={p.covers}
        kicker={p.sourceUrl ? `Playlist · from ${new URL(p.sourceUrl.replace(/^spotify:/, 'https://open.spotify.com/')).hostname.replace('www.', '')}` : 'Playlist'}
        title={p.name}
        description={p.description}
        meta={
          <>
            {user && <Avatar name={user.name} className="mr-1 h-6 w-6 text-xs" />}
            <span className="font-bold">{user?.name ?? 'Tuno'}</span>
            <span className="text-text/70">• {plural(p.count, 'song')}{p.duration > 0 && `, ${fmtLong(p.duration)}`}</span>
          </>
        }
      />
      <ActionBar tint={tint}>
        <PlayAllBar
          tracks={p.tracks}
          context={`playlist:${p.id}`}
          extra={
            <>
              {p.sourceUrl && (
                <button onClick={sync} disabled={syncing} className="icon-btn" title="Sync: download songs added to the original since import">
                  <RefreshCw className={`h-6 w-6 ${syncing ? 'animate-spin' : ''}`} />
                </button>
              )}
              <button onClick={menu.open} className="icon-btn" aria-label="More options">
                <MoreHorizontal className="h-7 w-7" />
              </button>
            </>
          }
        />
        <div className="ml-auto max-md:hidden">
          <FilterInput value={q} onChange={setQ} placeholder="Search in playlist" />
        </div>
      </ActionBar>

      {p.pending > 0 && (
        <Link to="/downloads" className="relative mx-4 mb-4 flex items-center gap-3 rounded-md bg-text/5 px-4 py-3 text-sm hover:bg-text/10 md:mx-6">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          {plural(p.pending, 'song')} still downloading — they'll appear here as they finish.
        </Link>
      )}

      <div className="relative px-2 md:px-4">
        {p.tracks.length === 0 && !p.pending ? (
          <Empty
            icon={<ListMusic className="h-12 w-12" />}
            title="Let's find something for your playlist"
            body="Add songs from your library with the ⋯ menu, or paste a link to download straight into this playlist."
            action={
              <button onClick={() => openImport('', id)} className="btn-accent">
                <Link2 className="h-4 w-4" /> Add from link
              </button>
            }
          />
        ) : (
          <TrackList
            tracks={filtered}
            queueSource={p.tracks}
            context={`playlist:${p.id}`}
            playlistId={p.id}
            reorderable={!q}
            onReorder={async (ids) => {
              qc.setQueryData(['playlist', id], { ...p, tracks: ids.map((tid) => p.tracks.find((t) => t.id === tid)!) });
              await api.reorderPlaylist(id, ids);
            }}
          />
        )}
      </div>

      <Menu
        {...menu.props([
          { label: 'Add from link', icon: <Link2 className="h-4 w-4" />, onClick: () => openImport('', id) },
          { label: 'Edit details', icon: <Pencil className="h-4 w-4" />, onClick: () => setEditing(true) },
          ...(p.sourceUrl
            ? [
                { label: 'Sync with original', icon: <RefreshCw className="h-4 w-4" />, onClick: sync },
                { label: 'Open original', icon: <ExternalLink className="h-4 w-4" />, onClick: () => window.open(p.sourceUrl!, '_blank', 'noopener') },
              ]
            : []),
          { label: '', divider: true },
          { label: 'Delete playlist', icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: remove },
          {
            label: 'Delete playlist and its songs',
            icon: <Trash2 className="h-4 w-4" />,
            danger: true,
            onClick: () =>
              ask({
                title: `Delete “${p.name}” and its songs?`,
                body: 'Songs that are not in any other playlist will be deleted from the server. This cannot be undone.',
                confirmLabel: 'Delete everything',
                danger: true,
                onConfirm: async () => {
                  await api.deletePlaylist(id, true);
                  qc.invalidateQueries();
                  navigate('/library?tab=playlists');
                },
              }),
          },
        ])}
      />
      <EditPlaylist open={editing} onClose={() => setEditing(false)} playlist={p} onSaved={() => {
          qc.invalidateQueries({ queryKey: ['playlist', id] });
          qc.invalidateQueries({ queryKey: ['playlists'] });
        }} />
    </div>
  );
}

function EditPlaylist({
  open,
  onClose,
  playlist,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  playlist: { id: number; name: string; description: string | null; cover: string | null; covers: string[] };
  onSaved: () => void;
}) {
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description ?? '');
  const [cover, setCover] = useState<string | null | undefined>(undefined);
  const toast = useUI((s) => s.toast);

  // Reset the form only when the dialog opens — not on every refetch (songs finishing downloads
  // refresh the playlist, which would otherwise wipe what you're typing).
  useEffect(() => {
    if (open) {
      setName(playlist.name);
      setDescription(playlist.description ?? '');
      setCover(undefined);
    }
  }, [open, playlist.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal open={open} onClose={onClose} title="Edit details">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.updatePlaylist(playlist.id, { name, description, ...(cover !== undefined ? { cover } : {}) });
            onSaved();
            onClose();
          } catch (err) {
            toast((err as Error).message, 'error');
          }
        }}
        className="flex flex-col gap-4 sm:flex-row"
      >
        <div className="flex flex-col items-center gap-2">
          <label className="group relative h-44 w-44 shrink-0 cursor-pointer">
            <Cover src={cover === undefined ? playlist.cover : cover} mosaic={playlist.covers} className="h-44 w-44" />
            <span className="cover absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-sm font-semibold opacity-0 transition-opacity group-hover:opacity-100">
              <ImagePlus className="h-8 w-8" /> Choose photo
            </span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => readImage(e.target.files?.[0], setCover)} />
          </label>
          {(playlist.cover || cover) && (
            <button type="button" onClick={() => setCover(null)} className="text-xs text-muted hover:text-text">
              Remove photo
            </button>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="input" required />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add an optional description" rows={5} className="input resize-none" />
          <div className="flex justify-end">
            <button className="btn-accent">Save</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
