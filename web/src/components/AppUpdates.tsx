import { useQuery } from '@tanstack/react-query';
import { Download, Monitor, RefreshCw, RotateCw, Smartphone } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type AppInfo } from '../lib/api';
import { fmtBytes } from '../lib/format';

/**
 * The Windows app is this same page inside its WebView2 window. The window says so in the user agent ("TunoWindows/1.1.4")
 * and exposes a message channel that the updater answers on.
 */
interface ShellBridge {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', fn: (e: { data: unknown }) => void): void;
  removeEventListener(type: 'message', fn: (e: { data: unknown }) => void): void;
}

function windowsApp(): { version: string; bridge: ShellBridge | null } | null {
  const v = navigator.userAgent.match(/TunoWindows\/([\d.]+)/);
  if (!v) return null;
  const bridge = (window as unknown as { chrome?: { webview?: ShellBridge } }).chrome?.webview ?? null;
  return { version: v[1], bridge };
}

interface ShellStatus {
  type?: string;
  state: 'idle' | 'checking' | 'ready' | 'uptodate' | 'error';
  auto?: boolean;
  version?: string | null;
  message?: string;
}

/** Settings → Updates: the Windows app's own update controls, and the downloads for the apps that update themselves. */
export function AppUpdates() {
  const win = windowsApp();
  return (
    <div className="space-y-5">
      {win && <WindowsUpdates version={win.version} bridge={win.bridge} />}
      <Downloads />
    </div>
  );
}

function Card({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle: string; children?: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-elevated ring-1 ring-text/10">
      <div className="flex items-center gap-4 p-5 md:p-6">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold tracking-tight">{title}</div>
          <div className="truncate text-sm text-muted">{subtitle}</div>
        </div>
      </div>
      {children && <div className="border-t border-text/5 bg-text/[0.03] px-5 py-4 md:px-6">{children}</div>}
    </section>
  );
}

function WindowsUpdates({ version, bridge }: { version: string; bridge: ShellBridge | null }) {
  const [status, setStatus] = useState<ShellStatus>({ state: 'idle' });

  useEffect(() => {
    if (!bridge) return;
    const onMessage = (e: { data: unknown }) => {
      const d = e.data as ShellStatus | null;
      if (d && d.type === 'update-status') setStatus(d);
    };
    bridge.addEventListener('message', onMessage);
    const ask = () => bridge.postMessage({ type: 'get-status' });
    ask();
    // Keep the numbers fresh while the window is on screen; a hidden window doesn't need the chatter.
    const timer = setInterval(() => {
      if (!document.hidden) ask();
    }, 5000);
    return () => {
      clearInterval(timer);
      bridge.removeEventListener('message', onMessage);
    };
  }, [bridge]);

  const send = (type: string, extra: Record<string, unknown> = {}) => bridge?.postMessage({ type, ...extra });
  const checking = status.state === 'checking';
  const ready = status.state === 'ready' && !!status.version;
  const subtitle =
    status.state === 'checking'
      ? 'Checking for updates...'
      : ready
        ? `Version ${status.version} is ready to install`
        : status.state === 'uptodate'
          ? `Version ${version} · up to date`
          : status.state === 'error'
            ? status.message || "Couldn't check for updates"
            : `Version ${version}`;

  return (
    <Card icon={<Monitor className="h-7 w-7" />} title="Tuno for Windows" subtitle={subtitle}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted">
          {ready
            ? 'Tuno restarts to install it. Music stops for a moment.'
            : 'New versions download in the background and install when no music is playing.'}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {ready ? (
            <button onClick={() => send('install-update')} className="btn-accent">
              <RotateCw className="h-4 w-4" /> Restart to update to {status.version}
            </button>
          ) : (
            <button onClick={() => send('check-update')} disabled={checking || !bridge} className="btn-accent">
              <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} /> {checking ? 'Checking...' : 'Check for updates'}
            </button>
          )}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-4 border-t border-text/5 pt-4">
        <div>
          <div className="font-medium">Update automatically</div>
          <div className="text-sm text-muted">Install new versions as soon as no music is playing.</div>
        </div>
        <Switch value={!!status.auto} disabled={!bridge} onChange={(v) => send('set-auto', { on: v })} label="Update automatically" />
      </div>
    </Card>
  );
}

function Switch({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${value ? 'bg-accent' : 'bg-text/25'}`}
    >
      <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${value ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

function Downloads() {
  const windows = useQuery({ queryKey: ['app-latest', 'windows'], queryFn: () => api.appLatest('windows'), staleTime: 5 * 60_000 });
  const android = useQuery({ queryKey: ['app-latest', 'android'], queryFn: () => api.appLatest('android'), staleTime: 5 * 60_000 });
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        The installed apps update themselves from this server. Download them once, then they keep up to date on their own.
      </p>
      <DownloadCard
        icon={<Monitor className="h-7 w-7" />}
        title="Tuno for Windows"
        info={windows.data}
        loading={windows.isLoading}
        href="/api/app/download/windows"
        file="Tuno.exe"
      />
      <DownloadCard
        icon={<Smartphone className="h-7 w-7" />}
        title="Tuno for Android"
        info={android.data}
        loading={android.isLoading}
        href="/api/app/download/android"
        file="Tuno.apk"
      />
    </div>
  );
}

function DownloadCard({
  icon,
  title,
  info,
  loading,
  href,
  file,
}: {
  icon: ReactNode;
  title: string;
  info: AppInfo | null | undefined;
  loading: boolean;
  href: string;
  file: string;
}) {
  const subtitle = loading ? 'Checking...' : info ? `Version ${info.version} · ${fmtBytes(info.size)}` : 'Not published yet';
  return (
    <Card icon={icon} title={title} subtitle={subtitle}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="line-clamp-2 min-w-0 text-sm text-muted">{info?.notes ?? ''}</p>
        {info && (
          <a href={href} download={file} className="btn-subtle shrink-0">
            <Download className="h-4 w-4" /> Download
          </a>
        )}
      </div>
    </Card>
  );
}
