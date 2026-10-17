import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, HardDrive, ImagePlus, Loader2, RefreshCw, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppUpdates } from '../components/AppUpdates';
import { readImage } from '../components/Dialogs';
import { Page } from '../components/Page';
import { Storage } from './Storage';
import { Account, Users } from './Accounts';
import { useAuth } from '../store/auth';
import { api, type DownloadSettings } from '../lib/api';
import { fmtBytes, fmtLong } from '../lib/format';
import { useTheme } from '../store/theme';
import { useUI } from '../store/ui';
import { DEFAULT_THEME, FONTS, PRESETS, loadFont, type Theme, type ThemeColors } from '../theme/theme';

const TABS = [
  { id: 'account', label: 'Account', admin: false },
  { id: 'appearance', label: 'Appearance', admin: false },
  { id: 'storage', label: 'Storage', admin: false },
  { id: 'updates', label: 'Updates', admin: false },
  { id: 'assistant', label: 'Assistant', admin: false },
  { id: 'users', label: 'Users', admin: true },
  { id: 'sources', label: 'Sources', admin: true },
  { id: 'system', label: 'System', admin: true },
  { id: 'shortcuts', label: 'Shortcuts', admin: false },
] as const;

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const isAdmin = useAuth((s) => !!s.user?.isAdmin);
  const tabs = TABS.filter((t) => isAdmin || !t.admin);
  const requested = params.get('tab');
  const tab = tabs.find((t) => t.id === requested)?.id ?? 'account';
  return (
    <Page>
      <h1 className="mb-5 text-3xl font-extrabold tracking-tight">Settings</h1>
      <div className="no-scrollbar mb-8 flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setParams({ tab: t.id }, { replace: true })} className={`shrink-0 ${tab === t.id ? 'chip-active' : 'chip'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="max-w-4xl">
        {tab === 'account' && <Account />}
        {tab === 'appearance' && <Appearance />}
        {tab === 'storage' && <Storage />}
        {tab === 'updates' && <AppUpdates />}
        {tab === 'assistant' && <AssistantSettings />}
        {tab === 'users' && <Users />}
        {tab === 'sources' && <Sources />}
        {tab === 'system' && <System />}
        {tab === 'shortcuts' && <Shortcuts />}
      </div>
    </Page>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-text/5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-medium">{label}</div>
        {hint && <div className="text-sm text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${value ? 'bg-accent' : 'bg-text/25'}`}
    >
      <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${value ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-full bg-text/10 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${value === o.id ? 'bg-text text-bg' : 'text-muted hover:text-text'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Slider({ value, min, max, step = 1, unit = '', onChange }: { value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider w-44"
        style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }}
      />
      <span className="w-12 text-right text-sm tabular-nums text-muted">
        {value}
        {unit}
      </span>
    </div>
  );
}

const COLOR_LABELS: Record<keyof ThemeColors, string> = {
  accent: 'Accent',
  bg: 'Background',
  surface: 'Sidebar & frame',
  elevated: 'Cards & menus',
  text: 'Text',
  muted: 'Secondary text',
};

function Appearance() {
  const { theme, set, replace } = useTheme();
  const toast = useUI((s) => s.toast);
  const [css, setCss] = useState(theme.customCss);

  useEffect(() => setCss(theme.customCss), [theme.customCss]);
  useEffect(() => FONTS.forEach((f) => loadFont(f.name)), []);

  const exportTheme = () => {
    const blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tuno-theme.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importTheme = (file?: File) => {
    if (!file) return;
    file.text().then((txt) => {
      try {
        replace(JSON.parse(txt) as Theme);
        toast('Theme imported', 'success');
      } catch {
        toast('That file is not a Tuno theme', 'error');
      }
    });
  };

  return (
    <>
      <Section title="Theme" description="Start from a preset, then tweak anything below. Changes apply instantly and sync to every device.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Object.entries(PRESETS).map(([id, p]) => (
            <button
              key={id}
              onClick={() => set({ preset: id, colors: p.colors })}
              className={`overflow-hidden rounded-lg text-left ring-2 transition-transform hover:scale-[1.03] ${theme.preset === id ? 'ring-accent' : 'ring-transparent'}`}
            >
              <div className="flex h-16" style={{ background: p.colors.bg }}>
                <div className="w-1/4" style={{ background: p.colors.surface }} />
                <div className="flex flex-1 flex-col justify-center gap-1.5 px-2">
                  <div className="h-1.5 w-3/4 rounded-full" style={{ background: p.colors.text }} />
                  <div className="h-1.5 w-1/2 rounded-full" style={{ background: p.colors.muted }} />
                  <div className="h-3 w-3 rounded-full" style={{ background: p.colors.accent }} />
                </div>
              </div>
              <div className="flex items-center justify-between bg-elevated px-2.5 py-2 text-sm font-medium">
                {p.label}
                {theme.preset === id && <Check className="h-4 w-4 text-accent" />}
              </div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Colors">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(COLOR_LABELS) as (keyof ThemeColors)[]).map((k) => (
            <label key={k} className="flex cursor-pointer items-center gap-3 rounded-md bg-text/5 p-3 hover:bg-text/10">
              <input
                type="color"
                value={theme.colors[k]}
                onChange={(e) => set({ preset: 'custom', colors: { ...theme.colors, [k]: e.target.value } })}
                className="h-9 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{COLOR_LABELS[k]}</div>
                <input
                  value={theme.colors[k]}
                  onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && set({ preset: 'custom', colors: { ...theme.colors, [k]: e.target.value } })}
                  className="w-full bg-transparent font-mono text-xs uppercase text-muted outline-none"
                  maxLength={7}
                />
              </div>
            </label>
          ))}
        </div>
        <Row label="Accent follows the song" hint="Use the color of the current cover art as the accent.">
          <Toggle value={theme.dynamicAccent} onChange={(v) => set({ dynamicAccent: v })} label="Dynamic accent" />
        </Row>
        <Row label="Album color headers" hint="Tint playlist, album and artist headers with their artwork colors.">
          <Toggle value={theme.dynamicColor} onChange={(v) => set({ dynamicColor: v })} label="Album color headers" />
        </Row>
      </Section>

      <Section title="Typography">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {FONTS.map((f) => (
            <button
              key={f.name}
              onClick={() => set({ font: f.name })}
              className={`rounded-md px-3 py-3 text-left ring-2 transition-colors ${theme.font === f.name ? 'bg-text/10 ring-accent' : 'bg-text/5 ring-transparent hover:bg-text/10'}`}
              style={{ fontFamily: f.name === 'System' ? 'system-ui' : `'${f.name}'` }}
            >
              <div className="text-2xl font-bold">Aa</div>
              <div className="truncate text-sm">{f.name}</div>
            </button>
          ))}
        </div>
        <Row label="Text size">
          <Slider value={Math.round(theme.fontScale * 100)} min={80} max={130} step={5} unit="%" onChange={(v) => set({ fontScale: v / 100 })} />
        </Row>
      </Section>

      <Section title="Shape & layout">
        <Row label="Corner roundness">
          <Slider value={theme.radius} min={0} max={24} unit="px" onChange={(v) => set({ radius: v })} />
        </Row>
        <Row label="Cover art shape">
          <Segmented
            value={theme.coverShape}
            onChange={(v) => set({ coverShape: v })}
            options={[
              { id: 'square', label: 'Square' },
              { id: 'rounded', label: 'Rounded' },
              { id: 'circle', label: 'Circle' },
            ]}
          />
        </Row>
        <Row label="List density">
          <Segmented
            value={theme.density}
            onChange={(v) => set({ density: v })}
            options={[
              { id: 'compact', label: 'Compact' },
              { id: 'cozy', label: 'Cozy' },
              { id: 'comfortable', label: 'Roomy' },
            ]}
          />
        </Row>
        <Row label="Sidebar side">
          <Segmented
            value={theme.sidebar}
            onChange={(v) => set({ sidebar: v })}
            options={[
              { id: 'left', label: 'Left' },
              { id: 'right', label: 'Right' },
            ]}
          />
        </Row>
        <Row label="Sidebar width">
          <Slider value={theme.sidebarWidth} min={220} max={480} step={10} unit="px" onChange={(v) => set({ sidebarWidth: v })} />
        </Row>
        <Row label="Player style">
          <Segmented
            value={theme.player}
            onChange={(v) => set({ player: v })}
            options={[
              { id: 'docked', label: 'Docked' },
              { id: 'floating', label: 'Floating' },
            ]}
          />
        </Row>
      </Section>

      <Section title="Background" description="Put any image behind the app. Panels turn translucent so it shows through.">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <label className="group relative flex h-32 w-56 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-text/5 ring-1 ring-text/10">
            {theme.bgImage ? (
              <img src={theme.bgImage} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex flex-col items-center gap-1 text-sm text-muted">
                <ImagePlus className="h-6 w-6" /> Choose image
              </span>
            )}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => readImage(e.target.files?.[0], (d) => set({ bgImage: d }), 1920)} />
          </label>
          <div className="flex-1 space-y-2">
            <input
              value={theme.bgImage.startsWith('data:') ? '' : theme.bgImage}
              onChange={(e) => set({ bgImage: e.target.value })}
              placeholder="…or paste an image URL"
              className="input"
            />
            {theme.bgImage && (
              <button onClick={() => set({ bgImage: '' })} className="btn-subtle">
                <Trash2 className="h-4 w-4" /> Remove background
              </button>
            )}
          </div>
        </div>
        <Row label="Blur">
          <Slider value={theme.bgBlur} min={0} max={60} unit="px" onChange={(v) => set({ bgBlur: v })} />
        </Row>
        <Row label="Darken">
          <Slider value={theme.bgDim} min={0} max={95} unit="%" onChange={(v) => set({ bgDim: v })} />
        </Row>
        <Row label="Glass panels" hint="Frosted, see-through panels (on automatically with a background image).">
          <Toggle value={theme.glass} onChange={(v) => set({ glass: v })} label="Glass panels" />
        </Row>
      </Section>

      <Section title="Effects">
        <Row label="Gradient headers">
          <Toggle value={theme.gradientHeaders} onChange={(v) => set({ gradientHeaders: v })} label="Gradient headers" />
        </Row>
        <Row label="Audio visualizer" hint="Animated bars in the player while music plays.">
          <Toggle value={theme.showVisualizer} onChange={(v) => set({ showVisualizer: v })} label="Visualizer" />
        </Row>
        <Row label="Animations">
          <Toggle value={theme.animations} onChange={(v) => set({ animations: v })} label="Animations" />
        </Row>
      </Section>

      <Section title="Custom CSS" description="Full control: anything you write here is applied on top of the theme. Variables like --c-accent, --radius and --font are available.">
        <textarea
          value={css}
          onChange={(e) => setCss(e.target.value)}
          spellCheck={false}
          rows={8}
          placeholder={`/* Example */\n.panel { border: 1px solid rgb(var(--c-accent) / .3); }\nh1 { letter-spacing: -0.04em; }`}
          className="input font-mono text-xs"
        />
        <div className="mt-2 flex gap-2">
          <button onClick={() => set({ customCss: css })} disabled={css === theme.customCss} className="btn-accent">
            Apply CSS
          </button>
        </div>
      </Section>

      <Section title="Share & reset">
        <div className="flex flex-wrap gap-2">
          <button onClick={exportTheme} className="btn-subtle">
            <Download className="h-4 w-4" /> Export theme
          </button>
          <label className="btn-subtle cursor-pointer">
            <Upload className="h-4 w-4" /> Import theme
            <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => importTheme(e.target.files?.[0])} />
          </label>
          <button onClick={() => replace(DEFAULT_THEME)} className="btn-subtle">
            <RotateCcw className="h-4 w-4" /> Reset to default
          </button>
        </div>
      </Section>
    </>
  );
}

function Sources() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const toast = useUI((s) => s.toast);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [cookies, setCookies] = useState('');

  useEffect(() => {
    if (data?.spotify) setClientId(data.spotify.clientId);
  }, [data]);

  const saveSpotify = async () => {
    await api.saveSpotify(clientId, secret);
    setSecret('');
    qc.invalidateQueries({ queryKey: ['settings'] });
    toast('Spotify settings saved', 'success');
  };

  return (
    <>
      <Section
        title="Spotify"
        description="Spotify links work out of the box for up to ~100 songs per playlist. For bigger playlists, add a free Spotify developer app (developer.spotify.com → Dashboard → Create app) and paste its Client ID and Secret here."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="label">Client ID</span>
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} className="input mt-1 font-mono" autoComplete="off" />
          </label>
          <label>
            <span className="label">Client secret</span>
            <input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              type="password"
              placeholder={data?.spotify?.hasSecret ? '•••••••• (saved)' : ''}
              className="input mt-1 font-mono"
              autoComplete="new-password"
            />
          </label>
        </div>
        <button onClick={saveSpotify} className="btn-accent mt-3">
          Save
        </button>
        <div className="mt-6">
          <Row
            label="Spotify downloads"
            hint={
              data?.spotify?.hasSecret && data.spotify.clientId
                ? 'Lets everyone download songs, albums and playlists from Spotify links and search Spotify.'
                : 'Save your Client ID and Secret above first. Then you can turn this on.'
            }
          >
            <Toggle
              value={!!data?.spotifyDownloads}
              disabled={!data?.spotifyDownloads && !(data?.spotify?.hasSecret && data.spotify.clientId)}
              label="Spotify downloads"
              onChange={async (v) => {
                try {
                  await api.setSpotifyDownloads(v);
                  qc.invalidateQueries({ queryKey: ['settings'] });
                  toast(v ? 'Spotify downloads are on' : 'Spotify downloads are off', 'success');
                } catch (err) {
                  toast((err as Error).message, 'error');
                }
              }}
            />
          </Row>
        </div>
      </Section>

      <Section
        title="YouTube cookies"
        description="If YouTube says “Sign in to confirm you're not a bot”, export your YouTube cookies with a browser extension like “Get cookies.txt LOCALLY” and paste the file contents here. Use a throwaway Google account if you can."
      >
        <div className="mb-3 flex items-center gap-2 text-sm">
          {data?.hasCookies ? (
            <>
              <Check className="h-4 w-4 text-accent" /> Cookies are set
              <button
                onClick={async () => {
                  await api.deleteCookies();
                  qc.invalidateQueries({ queryKey: ['settings'] });
                  toast('Cookies removed', 'success');
                }}
                className="ml-2 text-red-400 hover:underline"
              >
                Remove
              </button>
            </>
          ) : (
            <span className="text-muted">No cookies set (usually not needed).</span>
          )}
        </div>
        <textarea
          value={cookies}
          onChange={(e) => setCookies(e.target.value)}
          rows={5}
          placeholder="# Netscape HTTP Cookie File …"
          className="input font-mono text-xs"
          spellCheck={false}
        />
        <button
          disabled={!cookies.trim()}
          onClick={async () => {
            try {
              await api.saveCookies(cookies);
              setCookies('');
              qc.invalidateQueries({ queryKey: ['settings'] });
              toast('Cookies saved', 'success');
            } catch (err) {
              toast((err as Error).message, 'error');
            }
          }}
          className="btn-accent mt-3"
        >
          Save cookies
        </button>
      </Section>

      <Section title="Supported sites" description="Anything yt-dlp supports works with “Add from link”, including:">
        <div className="flex flex-wrap gap-2">
          {['YouTube', 'YouTube Music', 'Spotify (matched)', 'SoundCloud', 'Bandcamp', 'Mixcloud', 'Audiomack', 'Vimeo', 'Twitch VODs', 'TikTok', 'Instagram', 'X / Twitter', 'Reddit', 'Deezer previews', 'Archive.org', 'and ~1,800 more'].map((s) => (
            <span key={s} className="chip cursor-default">
              {s}
            </span>
          ))}
        </div>
      </Section>
    </>
  );
}

function System() {
  const { data, refetch, isFetching } = useQuery({ queryKey: ['system'], queryFn: api.system });
  const [updating, setUpdating] = useState(false);
  const toast = useUI((s) => s.toast);

  return (
    <>
      <Section title="Library">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Songs" value={data ? data.tracks.toLocaleString() : '…'} />
          <Stat label="Listening time" value={data ? fmtLong(data.seconds) : '…'} />
          <Stat label="Size on disk" value={data ? fmtBytes(data.librarySize) : '…'} />
        </div>
        {data?.disk && (
          <div className="mt-4 rounded-md bg-text/5 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm">
              <HardDrive className="h-4 w-4 text-muted" />
              {fmtBytes(data.disk.free)} free of {fmtBytes(data.disk.total)}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-text/10">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(1 - data.disk.free / data.disk.total) * 100}%` }} />
            </div>
          </div>
        )}
      </Section>
      <Section
        title="Download limits"
        description="Keep the server light: smaller files, no endless uploads, and a free-space reserve so the disk can never fill up. Applies to new downloads for every account."
      >
        {data && <DownloadLimits value={data.downloads} onSaved={() => refetch()} />}
      </Section>
      <Section title="Downloader" description="Tuno uses yt-dlp to download. Sites change often — if downloads start failing, update it.">
        <Row label="yt-dlp version" hint={data?.ytdlp ?? 'Checking…'}>
          <div className="flex gap-2">
            <button onClick={() => refetch()} className="btn-subtle" disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </button>
            <button
              disabled={updating}
              onClick={async () => {
                setUpdating(true);
                try {
                  const r = await api.updateYtdlp();
                  toast(`yt-dlp is now ${r.version}`, 'success');
                  refetch();
                } catch (err) {
                  toast((err as Error).message, 'error');
                } finally {
                  setUpdating(false);
                }
              }}
              className="btn-accent"
            >
              {updating && <Loader2 className="h-4 w-4 animate-spin" />}
              Update yt-dlp
            </button>
          </div>
        </Row>
      </Section>
    </>
  );
}

const QUALITY_OPTIONS = [
  { id: 'saver', label: 'Saver — about 0.4 MB per minute (~50 kbps)' },
  { id: 'balanced', label: 'Balanced — about 1 MB per minute (~128 kbps)' },
  { id: 'best', label: 'Best — the original stream, largest files' },
] as const;
const LENGTH_OPTIONS = [10, 20, 30, 60, 120, 0];
const FREE_OPTIONS = [5, 10, 20, 50, 100];

function DownloadLimits({ value, onSaved }: { value: DownloadSettings; onSaved: () => void }) {
  const toast = useUI((s) => s.toast);
  const save = async (patch: Partial<DownloadSettings>) => {
    try {
      await api.saveDownloadSettings(patch);
      onSaved();
      toast('Saved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const lengths = LENGTH_OPTIONS.includes(value.maxMinutes) ? LENGTH_OPTIONS : [...LENGTH_OPTIONS, value.maxMinutes];
  const frees = FREE_OPTIONS.includes(value.minFreeGb) ? FREE_OPTIONS : [...FREE_OPTIONS, value.minFreeGb];
  return (
    <>
      <Row label="Audio quality" hint="Picks a smaller stream when one exists. Nothing is re-encoded, so it costs no CPU.">
        <select value={value.quality} onChange={(e) => save({ quality: e.target.value as DownloadSettings['quality'] })} className="input w-auto">
          {QUALITY_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Longest song" hint="Longer uploads (DJ sets, hour-long loops) are skipped.">
        <select value={value.maxMinutes} onChange={(e) => save({ maxMinutes: Number(e.target.value) })} className="input w-auto">
          {lengths.map((m) => (
            <option key={m} value={m}>
              {m ? `${m} minutes` : 'No limit'}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Keep this much disk free" hint="Downloads pause for everyone while the server has less free space than this.">
        <select value={value.minFreeGb} onChange={(e) => save({ minFreeGb: Number(e.target.value) })} className="input w-auto">
          {frees.map((g) => (
            <option key={g} value={g}>
              {g} GB
            </option>
          ))}
        </select>
      </Row>
    </>
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

function AssistantSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const toast = useUI((s) => s.toast);
  return (
    <Section
      title="Assistant"
      description="The assistant can look through your library and playlists, search for music, and propose new playlists and downloads. You approve each change in the Assistant page."
    >
      <Link to="/assistant" className="btn-accent mb-6">
        Open the assistant
      </Link>
      <Row label="Bypass permissions" hint="Let the assistant make changes straight away, without asking. Off by default.">
        <Toggle
          value={!!data?.assistantBypass}
          label="Bypass permissions"
          onChange={async (v) => {
            try {
              await api.setAssistantBypass(v);
              qc.invalidateQueries({ queryKey: ['settings'] });
              toast(v ? 'The assistant will act without asking' : 'The assistant will ask before changing anything', 'success');
            } catch (err) {
              toast((err as Error).message, 'error');
            }
          }}
        />
      </Row>
    </Section>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['← / →', 'Seek 5 seconds'],
  ['Shift + ← / →', 'Previous / next song'],
  ['↑ / ↓', 'Volume'],
  ['M', 'Mute'],
  ['S', 'Shuffle'],
  ['R', 'Repeat'],
  ['L', 'Like current song'],
  ['Q', 'Show queue'],
  ['F', 'Full-screen player'],
  ['/', 'Search'],
  ['Ctrl + V', 'Paste a link anywhere to download it'],
];

function Shortcuts() {
  return (
    <div className="divide-y divide-text/5">
      {SHORTCUTS.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between py-3">
          <span>{v}</span>
          <kbd className="rounded bg-text/10 px-2 py-1 font-mono text-sm">{k}</kbd>
        </div>
      ))}
    </div>
  );
}
