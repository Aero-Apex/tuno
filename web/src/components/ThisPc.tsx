import { HardDrive, Radio } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { windowsApp } from '../lib/windows';
import { Switch } from './AppUpdates';

interface ShellState {
  type?: string;
  local?: boolean;
  discord?: boolean;
}

/** Settings → This PC: the Windows app's own settings (where the music lives, and Discord). */
export function ThisPc() {
  const win = windowsApp();
  const bridge = win?.bridge ?? null;
  const [state, setState] = useState<ShellState>({ local: win?.local, discord: true });

  useEffect(() => {
    if (!bridge) return;
    const onMessage = (e: { data: unknown }) => {
      const d = e.data as ShellState | null;
      if (d && d.type === 'update-status') setState((prev) => ({ ...prev, local: d.local, discord: d.discord }));
    };
    bridge.addEventListener('message', onMessage);
    bridge.postMessage({ type: 'get-status' });
    return () => bridge.removeEventListener('message', onMessage);
  }, [bridge]);

  const setDiscord = (on: boolean) => {
    setState((prev) => ({ ...prev, discord: on }));
    bridge?.postMessage({ type: 'set-discord', on });
  };

  return (
    <div className="space-y-5">
      <Panel icon={<HardDrive className="h-6 w-6" />} title="Where your music lives" subtitle={state.local ? 'On this PC' : 'On your Tuno server'}>
        <p className="text-sm text-muted">
          {state.local
            ? 'Songs you download stay on this PC, in Tuno\'s own folder for your account. Nothing needs a server, and the library opens only on this PC.'
            : 'Songs you download are kept on the Tuno server you connect to. To keep music on this PC instead, choose "Run on this PC only" from the Tuno window\'s menu.'}
        </p>
      </Panel>

      <Panel icon={<Radio className="h-6 w-6" />} title="Discord" subtitle="Listening on your profile">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted">
            Shows the song, its artist and its progress on your Discord profile, like Spotify does. Discord must be open on this PC.
          </p>
          <Switch value={!!state.discord} disabled={!bridge} onChange={setDiscord} label="Show what I'm listening to on Discord" />
        </div>
      </Panel>
    </div>
  );
}

function Panel({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-elevated ring-1 ring-text/10">
      <div className="flex items-center gap-4 p-5 md:p-6">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">{icon}</div>
        <div className="min-w-0">
          <div className="text-lg font-bold tracking-tight">{title}</div>
          <div className="truncate text-sm text-muted">{subtitle}</div>
        </div>
      </div>
      <div className="border-t border-text/5 bg-text/[0.03] px-5 py-4 md:px-6">{children}</div>
    </section>
  );
}
