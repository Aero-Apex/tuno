import { create } from 'zustand';
import { api } from '../lib/api';
import { applyTheme, DEFAULT_THEME, normalizeTheme, type Theme } from '../theme/theme';

interface ThemeState {
  theme: Theme;
  /** Color pulled from the current song's cover. */
  dynamic: string | null;
  set: (patch: Partial<Theme>) => void;
  replace: (t: Theme) => void;
  setDynamic: (c: string | null) => void;
  loadFromServer: () => Promise<void>;
}

const local = (() => {
  try {
    return normalizeTheme(JSON.parse(localStorage.getItem('tuno-theme') ?? 'null'));
  } catch {
    return DEFAULT_THEME;
  }
})();

let saveTimer: number | undefined;
function persist(t: Theme) {
  try {
    localStorage.setItem('tuno-theme', JSON.stringify(t));
  } catch {
    /* a big background image can exceed the quota; the server copy still saves */
  }
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => api.saveTheme(t).catch(() => {}), 600);
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: local,
  dynamic: null,
  set: (patch) => {
    const theme = { ...get().theme, ...patch, colors: { ...get().theme.colors, ...(patch.colors ?? {}) } };
    set({ theme });
    applyTheme(theme, get().dynamic);
    persist(theme);
  },
  replace: (t) => {
    const theme = normalizeTheme(t);
    set({ theme });
    applyTheme(theme, get().dynamic);
    persist(theme);
  },
  setDynamic: (c) => {
    if (c === get().dynamic) return;
    set({ dynamic: c });
    applyTheme(get().theme, c);
  },
  loadFromServer: async () => {
    try {
      const s = await api.settings();
      if (s.theme) {
        const theme = normalizeTheme(s.theme);
        set({ theme });
        applyTheme(theme, get().dynamic);
        try {
          localStorage.setItem('tuno-theme', JSON.stringify(theme));
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* offline: keep the local copy */
    }
  },
}));

applyTheme(local);
