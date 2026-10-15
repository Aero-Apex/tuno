import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, HardDrive, Loader2, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Cover } from '../components/Cover';
import { Modal } from '../components/Dialogs';
import { api } from '../lib/api';
import { useActions } from '../lib/actions';
import { fmtAgo, fmtBytes, plural, SOURCE_COLOR, SOURCE_LABEL } from '../lib/format';
import { usePlayer } from '../store/player';
import { useUI } from '../store/ui';
import { QuotaBar } from './Accounts';

const SORTS = [
  { id: 'size', label: 'Largest first' },
  { id: 'added', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'title', label: 'Title' },
  { id: 'artist', label: 'Artist' },
] as const;

/** Settings → Storage: see what takes space and delete songs one by one, in bulk, or all at once. */
export function Storage() {
  const { data, isLoading } = useQuery({ queryKey: ['storage'], queryFn: api.storage });
  const actions = useActions();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>('size');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [clearOpen, setClearOpen] = useState(false);

  const tracks = useMemo(() => {
    const list = (data?.tracks ?? []).filter((t) => !q || `${t.title} ${t.artist} ${t.album ?? ''}`.toLowerCase().includes(q.toLowerCase()));
    const by: Record<string, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      size: (a, b) => b.size - a.size,
      added: (a, b) => b.addedAt - a.addedAt,
      oldest: (a, b) => a.addedAt - b.addedAt,
      title: (a, b) => a.title.localeCompare(b.title),
      artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
    };
    return [...list].sort(by[sort]);
  }, [data, q, sort]);

  const selectedSize = useMemo(() => tracks.filter((t) => selected.has(t.id)).reduce((a, t) => a + t.size, 0), [tracks, selected]);
  const allShownSelected = tracks.length > 0 && tracks.every((t) => selected.has(t.id));

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(tracks.map((t) => t.id)));

  const used = data?.totalSize ?? 0;
  const disk = data?.disk;

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Songs" value={data ? data.tracks.length.toLocaleString() : '…'} />
        <Stat label="Your music takes up" value={data ? fmtBytes(used) : '…'} />
        <Stat label="Space left" value={data ? fmtBytes(Math.max(0, data.quota - used)) : '…'} />
      </div>
      {data && <QuotaBar used={used} quota={data.quota} className="mb-4 rounded-md bg-text/5 p-4" />}
      {disk && (
        <div className="mb-10 rounded-md bg-text/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted">
            <HardDrive className="h-4 w-4" />
            Whole server disk (admin): {fmtBytes(disk.total - disk.free)} used of {fmtBytes(disk.total)}, {fmtBytes(disk.free)} free
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-text/10">
            <div className="h-full bg-text/30" style={{ width: `${((disk.total - disk.free) / disk.total) * 100}%` }} />
          </div>
        </div>
      )}
      {!disk && <div className="mb-10" />}

      <section className="mb-12">
        <h2 className="text-xl font-bold">Downloaded songs</h2>
        <p className="mt-1 text-sm text-muted">Select songs to delete them from the server. They're also removed from every playlist.</p>

        <div className="sticky top-[68px] z-10 -mx-2 mt-4 flex flex-wrap items-center gap-2 bg-bg/95 px-2 py-2 backdrop-blur">
          <label className="flex cursor-pointer items-center gap-2 rounded-full bg-text/10 px-3 py-2 text-sm font-medium hover:bg-text/15">
            <input type="checkbox" checked={allShownSelected} onChange={toggleAll} className="h-4 w-4 accent-[rgb(var(--c-accent))]" />
            {q ? 'Select shown' : 'Select all'}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter songs" className="input w-44 pl-8 sm:w-60" />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="input w-auto" aria-label="Sort">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2">
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} className="btn-subtle">
                Clear
              </button>
            )}
            <button
              disabled={!selected.size}
              onClick={() => actions.deleteTracks([...selected], () => setSelected(new Set()))}
              className="btn bg-red-500 text-white hover:bg-red-600"
            >
              <Trash2 className="h-4 w-4" />
              Delete {selected.size ? `${plural(selected.size, 'song')} · ${fmtBytes(selectedSize)}` : 'selected'}
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted" />
          </div>
        ) : tracks.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">{q ? 'No songs match.' : 'No downloaded songs yet.'}</p>
        ) : (
          <div className="mt-2">
            {tracks.map((t) => (
              <label
                key={t.id}
                style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 60px' }}
                className={`group flex cursor-pointer items-center gap-3 rounded px-2 py-2 transition-colors hover:bg-text/10 ${selected.has(t.id) ? 'bg-text/10' : ''}`}
              >
                <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="h-4 w-4 shrink-0 accent-[rgb(var(--c-accent))]" />
                <Cover src={t.cover} className="h-10 w-10 shrink-0 shadow-none" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.title}</div>
                  <div className="truncate text-sm text-muted">{t.artist}</div>
                </div>
                <span
                  className="hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white sm:inline"
                  style={{ background: SOURCE_COLOR[t.source] ?? '#555' }}
                >
                  {SOURCE_LABEL[t.source] ?? t.source}
                </span>
                <span className="hidden w-24 shrink-0 text-right text-sm text-muted md:block">{fmtAgo(t.addedAt)}</span>
                <span className="w-16 shrink-0 text-right text-sm tabular-nums text-muted">{fmtBytes(t.size)}</span>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    actions.deleteTrack(t);
                  }}
                  className="icon-btn shrink-0 opacity-0 hover:text-red-400 group-hover:opacity-100 max-md:opacity-100"
                  title="Delete this song"
                  aria-label={`Delete ${t.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-red-500/40 p-5">
        <h2 className="flex items-center gap-2 text-xl font-bold text-red-400">
          <AlertTriangle className="h-5 w-5" /> Danger zone
        </h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium">Delete all songs</div>
            <div className="text-sm text-muted">Removes every downloaded song from the server and stops downloads in progress.</div>
          </div>
          <button disabled={!data?.tracks.length} onClick={() => setClearOpen(true)} className="btn shrink-0 bg-red-500 text-white hover:bg-red-600">
            <Trash2 className="h-4 w-4" /> Delete all songs
          </button>
        </div>
      </section>

      <ClearAllDialog open={clearOpen} onClose={() => setClearOpen(false)} count={data?.tracks.length ?? 0} size={used} playlists={data?.playlists ?? 0} />
    </>
  );
}

function ClearAllDialog({ open, onClose, count, size, playlists }: { open: boolean; onClose: () => void; count: number; size: number; playlists: number }) {
  const [typed, setTyped] = useState('');
  const [deletePlaylists, setDeletePlaylists] = useState(false);
  const [clearHistory, setClearHistory] = useState(true);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);

  const run = async () => {
    setBusy(true);
    try {
      const ids = usePlayer.getState().queue.flatMap((q) => (q.track ? [q.track.id] : []));
      const r = await api.clearLibrary({ deletePlaylists, clearHistory });
      usePlayer.getState().dropTracks(ids);
      qc.invalidateQueries();
      toast(`Deleted ${plural(r.deleted, 'song')} · freed ${fmtBytes(r.freed)}`, 'success');
      setTyped('');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Delete all songs?">
      <p className="text-sm text-muted">
        This permanently deletes <b className="text-text">{plural(count, 'song')}</b> ({fmtBytes(size)}) from the server and cancels any downloads in
        progress. It cannot be undone.
      </p>
      <div className="mt-4 space-y-2">
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" checked={deletePlaylists} onChange={(e) => setDeletePlaylists(e.target.checked)} className="h-4 w-4 accent-red-500" />
          Also delete all {plural(playlists, 'playlist')}
        </label>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" checked={clearHistory} onChange={(e) => setClearHistory(e.target.checked)} className="h-4 w-4 accent-red-500" />
          Clear the download history
        </label>
      </div>
      <label className="mt-5 block text-sm">
        Type <b className="font-mono text-red-400">DELETE</b> to confirm
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="input mt-1.5 font-mono" />
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="btn-subtle">
          Cancel
        </button>
        <button disabled={typed !== 'DELETE' || busy} onClick={run} className="btn bg-red-500 text-white hover:bg-red-600">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Delete everything
        </button>
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-text/5 p-4">
      <div className="label">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
