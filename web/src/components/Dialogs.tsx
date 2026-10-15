import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Info, Link2, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useActions } from '../lib/actions';
import { usePlayer } from '../store/player';
import { useUI } from '../store/ui';
import { Cover } from './Cover';

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} animate-fade-in rounded-t-xl bg-elevated p-6 shadow-2xl sm:rounded-xl`}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="icon-btn -mr-2" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const EXAMPLES = ['YouTube', 'YT Music', 'Spotify', 'SoundCloud', 'Bandcamp', 'Mixcloud', 'Vimeo', '+1,800 more'];

export function ImportDialog() {
  const { importOpen, importUrl, importPlaylistId, closeImport } = useUI();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const actions = useActions();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: api.playlists, enabled: importOpen });
  const [target, setTarget] = useState<number | ''>('');

  useEffect(() => {
    if (importOpen) {
      setUrl(importUrl);
      setTarget(importPlaylistId ?? '');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [importOpen, importUrl, importPlaylistId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const links = url.split(/\s+/).filter(Boolean);
    if (!links.length) return;
    setBusy(true);
    try {
      for (const link of links) await actions.importUrl(link, target || undefined);
      closeImport();
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={importOpen} onClose={closeImport} title="Add music from a link">
      <form onSubmit={submit} className="space-y-4">
        <div className="relative">
          <Link2 className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted" />
          <textarea
            ref={inputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) submit(e);
            }}
            rows={3}
            placeholder="Paste a link to a song, album or playlist… (one per line for several)"
            className="input resize-none pl-10 pt-3"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((x) => (
            <span key={x} className="rounded-full bg-text/5 px-2 py-0.5 text-xs text-muted">
              {x}
            </span>
          ))}
        </div>
        <label className="block">
          <span className="label">Also add to playlist</span>
          <select value={target} onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : '')} className="input mt-1.5">
            <option value="">Automatic (playlist links create their own)</option>
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted">
          Songs download to your server and stay playable forever. Spotify songs are matched on YouTube Music automatically.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={closeImport} className="btn-subtle">
            Cancel
          </button>
          <button type="submit" disabled={busy || !url.trim()} className="btn-accent">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Download
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function EditTrackDialog() {
  const { editing, setEditing, toast } = useUI();
  const [form, setForm] = useState({ title: '', artist: '', album: '' });
  const [cover, setCover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing) {
      setForm({ title: editing.title, artist: editing.artist, album: editing.album ?? '' });
      setCover(null);
    }
  }, [editing]);

  if (!editing) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await api.updateTrack(editing.id, { ...form, album: form.album || null, ...(cover ? { cover } : {}) });
      usePlayer.getState().updateTrack(updated);
      toast('Saved', 'success');
      setEditing(null);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={() => setEditing(null)} title="Edit details">
      <form onSubmit={save} className="flex flex-col gap-4 sm:flex-row">
        <label className="group relative h-40 w-40 shrink-0 cursor-pointer self-center sm:self-start">
          <Cover src={cover ?? editing.cover} className="h-40 w-40" />
          <span className="cover absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-semibold opacity-0 transition-opacity group-hover:opacity-100">
            Choose photo
          </span>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => readImage(e.target.files?.[0], setCover)} />
        </label>
        <div className="flex-1 space-y-3">
          {(['title', 'artist', 'album'] as const).map((k) => (
            <label key={k} className="block">
              <span className="label">{k}</span>
              <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="input mt-1" />
            </label>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setEditing(null)} className="btn-subtle">
              Cancel
            </button>
            <button disabled={busy} className="btn-accent">
              Save
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Reads an image file, scaling it down so covers stay small. */
export function readImage(file: File | undefined, done: (dataUrl: string) => void, max = 800) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      done(canvas.toDataURL('image/jpeg', 0.88));
    };
    image.src = reader.result as string;
  };
  reader.readAsDataURL(file);
}

export function ConfirmDialog() {
  const { confirm, ask } = useUI();
  const [busy, setBusy] = useState(false);
  if (!confirm) return null;
  return (
    <Modal open onClose={() => ask(null)} title={confirm.title}>
      <p className="text-sm text-muted">{confirm.body}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={() => ask(null)} className="btn-subtle">
          Cancel
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await confirm.onConfirm();
            } finally {
              setBusy(false);
              ask(null);
            }
          }}
          className={confirm.danger ? 'btn bg-red-500 text-white hover:bg-red-600' : 'btn-accent'}
        >
          {confirm.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useUI();
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--player-h)+5rem)] z-[95] flex flex-col items-center gap-2 px-4 md:bottom-[calc(var(--player-h)+1.5rem)]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex max-w-md animate-fade-in items-center gap-3 rounded-md bg-text px-4 py-3 text-sm font-medium text-bg shadow-2xl"
        >
          {t.kind === 'success' ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-accent" />
          ) : t.kind === 'error' ? (
            <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
          ) : (
            <Info className="h-5 w-5 shrink-0" />
          )}
          <span className="line-clamp-3">{t.message}</span>
          {t.action && (
            <Link to={t.action.to} onClick={() => dismissToast(t.id)} className="shrink-0 font-bold underline-offset-2 hover:underline">
              {t.action.label}
            </Link>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}
