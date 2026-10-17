import { create } from 'zustand';
import type { Track } from '../lib/api';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; to: string };
}

/** What the right-hand panel shows next to the page (desktop): the playing song, the queue, or nothing. */
export type RightPanel = 'nowplaying' | 'queue' | null;

const stored = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const store = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode */
  }
};

interface UIState {
  toasts: Toast[];
  importOpen: boolean;
  importUrl: string;
  importPlaylistId: number | null;
  rightPanel: RightPanel;
  /** Your Library squeezed down to a column of covers. */
  libraryCollapsed: boolean;
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
  toggleNowPlayingView: () => void;
  setRightPanel: (p: RightPanel) => void;
  toggleLibrary: () => void;
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
  rightPanel: stored<RightPanel>('tuno-right-panel', 'nowplaying'),
  libraryCollapsed: stored('tuno-library-collapsed', false),
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
  // Below the width where the side panel fits, the queue opens in the full-screen player instead.
  toggleQueue: () => {
    if (!window.matchMedia('(min-width: 1024px)').matches) return set({ nowPlayingOpen: true });
    get().setRightPanel(get().rightPanel === 'queue' ? null : 'queue');
  },
  toggleNowPlayingView: () => get().setRightPanel(get().rightPanel === 'nowplaying' ? null : 'nowplaying'),
  setRightPanel: (p) => {
    store('tuno-right-panel', p);
    set({ rightPanel: p });
  },
  toggleLibrary: () => {
    store('tuno-library-collapsed', !get().libraryCollapsed);
    set({ libraryCollapsed: !get().libraryCollapsed });
  },
  setNowPlaying: (open) => set({ nowPlayingOpen: open }),
  setEditing: (t) => set({ editing: t }),
  ask: (c) => set({ confirm: c }),
  markPending: (key) => set({ pendingKeys: new Set(get().pendingKeys).add(key) }),
}));
