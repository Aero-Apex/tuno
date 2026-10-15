import { create } from 'zustand';
import type { Track } from '../lib/api';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; to: string };
}

interface UIState {
  toasts: Toast[];
  importOpen: boolean;
  importUrl: string;
  importPlaylistId: number | null;
  queueOpen: boolean;
  nowPlayingOpen: boolean;
  editing: Track | null;
  confirm: { title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => void } | null;
  /** Search result keys queued for download in this session, to show progress state in lists. */
  pendingKeys: Set<string>;

  toast: (message: string, kind?: Toast['kind'], action?: Toast['action']) => void;
  dismissToast: (id: number) => void;
  openImport: (url?: string, playlistId?: number | null) => void;
  closeImport: () => void;
  toggleQueue: () => void;
  setNowPlaying: (open: boolean) => void;
  setEditing: (t: Track | null) => void;
  ask: (c: UIState['confirm']) => void;
  markPending: (key: string) => void;
}

let toastId = 0;

export const useUI = create<UIState>((set, get) => ({
  toasts: [],
  importOpen: false,
  importUrl: '',
  importPlaylistId: null,
  queueOpen: false,
  nowPlayingOpen: false,
  editing: null,
  confirm: null,
  pendingKeys: new Set(),

  toast: (message, kind = 'info', action) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-3), { id, message, kind, action }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  openImport: (url = '', playlistId = null) => set({ importOpen: true, importUrl: url, importPlaylistId: playlistId }),
  closeImport: () => set({ importOpen: false }),
  toggleQueue: () => set({ queueOpen: !get().queueOpen }),
  setNowPlaying: (open) => set({ nowPlayingOpen: open }),
  setEditing: (t) => set({ editing: t }),
  ask: (c) => set({ confirm: c }),
  markPending: (key) => set({ pendingKeys: new Set(get().pendingKeys).add(key) }),
}));
