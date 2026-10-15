export interface ThemeColors {
  accent: string;
  bg: string;
  surface: string;
  elevated: string;
  text: string;
  muted: string;
}

export interface Theme {
  version: 1;
  preset: string;
  colors: ThemeColors;
  font: string;
  fontScale: number;
  radius: number;
  coverShape: 'square' | 'rounded' | 'circle';
  density: 'compact' | 'cozy' | 'comfortable';
  sidebar: 'left' | 'right';
  sidebarWidth: number;
  player: 'docked' | 'floating';
  bgImage: string;
  bgBlur: number;
  bgDim: number;
  /** Tint page headers with the colors of the album art. */
  dynamicColor: boolean;
  /** Use the current song's cover color as the accent. */
  dynamicAccent: boolean;
  gradientHeaders: boolean;
  glass: boolean;
  animations: boolean;
  showVisualizer: boolean;
  customCss: string;
}

export const FONTS: { name: string; google?: string }[] = [
  { name: 'Figtree', google: 'Figtree:wght@400;500;600;700;800' },
  { name: 'Inter', google: 'Inter:wght@400;500;600;700;800' },
  { name: 'DM Sans', google: 'DM+Sans:wght@400;500;600;700;800' },
  { name: 'Poppins', google: 'Poppins:wght@400;500;600;700;800' },
  { name: 'Outfit', google: 'Outfit:wght@400;500;600;700;800' },
  { name: 'Space Grotesk', google: 'Space+Grotesk:wght@400;500;600;700' },
  { name: 'Nunito', google: 'Nunito:wght@400;600;700;800' },
  { name: 'Sora', google: 'Sora:wght@400;500;600;700;800' },
  { name: 'JetBrains Mono', google: 'JetBrains+Mono:wght@400;500;700;800' },
  { name: 'Playfair Display', google: 'Playfair+Display:wght@400;600;700;800' },
  { name: 'System' },
];

export const PRESETS: Record<string, { label: string; colors: ThemeColors }> = {
  spotify: {
    label: 'Tuno Green',
    colors: { accent: '#1ed760', bg: '#121212', surface: '#000000', elevated: '#1f1f1f', text: '#ffffff', muted: '#a7a7a7' },
  },
  soundcloud: {
    label: 'Sunset Orange',
    colors: { accent: '#ff5500', bg: '#111111', surface: '#080808', elevated: '#232323', text: '#f5f5f5', muted: '#a3a3a3' },
  },
  youtube: {
    label: 'Music Red',
    colors: { accent: '#ff1744', bg: '#030303', surface: '#0f0f0f', elevated: '#212121', text: '#ffffff', muted: '#aaaaaa' },
  },
  midnight: {
    label: 'Midnight',
    colors: { accent: '#8b7bff', bg: '#0c0b16', surface: '#07060f', elevated: '#1b1930', text: '#eeecff', muted: '#9c99c2' },
  },
  ocean: {
    label: 'Ocean',
    colors: { accent: '#2dd4bf', bg: '#071419', surface: '#030b0e', elevated: '#11262e', text: '#e6fbff', muted: '#89aab3' },
  },
  rose: {
    label: 'Rosé',
    colors: { accent: '#fb7185', bg: '#140c0f', surface: '#0b0608', elevated: '#2a171d', text: '#fff1f3', muted: '#bf98a1' },
  },
  amber: {
    label: 'Vinyl',
    colors: { accent: '#f5b437', bg: '#15120c', surface: '#0c0a06', elevated: '#2a2418', text: '#fbf5e9', muted: '#b3a78f' },
  },
  mono: {
    label: 'Mono',
    colors: { accent: '#ffffff', bg: '#0a0a0a', surface: '#000000', elevated: '#1c1c1c', text: '#ffffff', muted: '#8f8f8f' },
  },
  light: {
    label: 'Daylight',
    colors: { accent: '#16a34a', bg: '#ffffff', surface: '#f2f2f3', elevated: '#e6e6e9', text: '#111113', muted: '#5f5f66' },
  },
  paper: {
    label: 'Paper',
    colors: { accent: '#c2410c', bg: '#f7f3ea', surface: '#efe8da', elevated: '#e3dac6', text: '#2a241b', muted: '#776b58' },
  },
};

export const DEFAULT_THEME: Theme = {
  version: 1,
  preset: 'spotify',
  colors: PRESETS.spotify.colors,
  font: 'Figtree',
  fontScale: 1,
  radius: 8,
  coverShape: 'rounded',
  density: 'cozy',
  sidebar: 'left',
  sidebarWidth: 280,
  player: 'docked',
  bgImage: '',
  bgBlur: 24,
  bgDim: 70,
  dynamicColor: true,
  dynamicAccent: false,
  gradientHeaders: true,
  glass: false,
  animations: true,
  showVisualizer: true,
  customCss: '',
};

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}

function luminance([r, g, b]: [number, number, number]) {
  const f = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function isLight(hex: string) {
  return luminance(hexToRgb(hex)) > 0.45;
}

const triplet = (hex: string) => hexToRgb(hex).join(' ');

const DENSITY = { compact: { row: '44px', gap: '0.75' }, cozy: { row: '56px', gap: '1' }, comfortable: { row: '68px', gap: '1.25' } };

/** Every CSS variable the theme controls. Also cached in localStorage for a flash-free first paint. */
export function themeVars(t: Theme, dynamic?: string | null): Record<string, string> {
  const accent = t.dynamicAccent && dynamic ? dynamic : t.colors.accent;
  return {
    '--c-accent': triplet(accent),
    '--c-on-accent': isLight(accent) ? '0 0 0' : '255 255 255',
    '--c-bg': triplet(t.colors.bg),
    '--c-surface': triplet(t.colors.surface),
    '--c-elevated': triplet(t.colors.elevated),
    '--c-text': triplet(t.colors.text),
    '--c-muted': triplet(t.colors.muted),
    '--c-dynamic': triplet(dynamic ?? t.colors.accent),
    '--font': t.font === 'System' ? 'system-ui' : `'${t.font}'`,
    '--font-scale': String(t.fontScale),
    '--radius': `${t.radius}px`,
    '--cover-radius': t.coverShape === 'circle' ? '9999px' : t.coverShape === 'square' ? '0px' : `${Math.max(4, t.radius * 0.75)}px`,
    '--row-h': DENSITY[t.density].row,
    '--gap-scale': DENSITY[t.density].gap,
    '--sidebar-w': `${t.sidebarWidth}px`,
    '--anim': t.animations ? '200ms' : '0ms',
    '--bg-blur': `${t.bgBlur}px`,
    '--bg-dim': String(t.bgDim / 100),
    '--panel-alpha': t.glass || t.bgImage ? '0.55' : '1',
    'color-scheme': isLight(t.colors.bg) ? 'light' : 'dark',
  };
}

const loadedFonts = new Set<string>();
export function loadFont(name: string) {
  const f = FONTS.find((x) => x.name === name);
  if (!f?.google || loadedFonts.has(name)) return;
  loadedFonts.add(name);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
  document.head.appendChild(link);
}

export function applyTheme(t: Theme, dynamic?: string | null) {
  const vars = themeVars(t, dynamic);
  const root = document.documentElement;
  for (const [k, val] of Object.entries(vars)) root.style.setProperty(k, val);
  root.dataset.player = t.player;
  root.dataset.sidebar = t.sidebar;
  root.dataset.glass = String(t.glass || !!t.bgImage);
  root.dataset.gradients = String(t.gradientHeaders);
  loadFont(t.font);

  let style = document.getElementById('tuno-custom-css') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'tuno-custom-css';
    document.head.appendChild(style);
  }
  style.textContent = t.customCss;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.colors.bg);

  try {
    localStorage.setItem('tuno-theme-vars', JSON.stringify(vars));
  } catch {
    /* storage unavailable */
  }
}

/** Merges a possibly partial/old theme object over the defaults. */
export function normalizeTheme(raw: unknown): Theme {
  if (!raw || typeof raw !== 'object') return DEFAULT_THEME;
  const r = raw as Partial<Theme>;
  return { ...DEFAULT_THEME, ...r, colors: { ...DEFAULT_THEME.colors, ...(r.colors ?? {}) }, version: 1 };
}
