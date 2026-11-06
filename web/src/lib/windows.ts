/**
 * The Windows app is this same page inside its WebView2 window. The window says so in the user agent
 * ("TunoWindows/1.1.6", plus "TunoLocal" when Tuno runs on this PC) and exposes a message channel.
 * The Mac app does the same in its WebKit window ("TunoMac/1.2.0"), with its own channel adapted to the same shape.
 */
export interface ShellBridge {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', fn: (e: { data: unknown }) => void): void;
  removeEventListener(type: 'message', fn: (e: { data: unknown }) => void): void;
}

export function windowsApp(): { version: string; local: boolean; bridge: ShellBridge | null } | null {
  const v = navigator.userAgent.match(/TunoWindows\/([\d.]+)/);
  if (!v) return null;
  const bridge = (window as unknown as { chrome?: { webview?: ShellBridge } }).chrome?.webview ?? null;
  return { version: v[1], local: /TunoLocal/.test(navigator.userAgent), bridge };
}

export interface DesktopApp {
  platform: 'windows' | 'mac';
  version: string;
  local: boolean;
  bridge: ShellBridge | null;
}

/** The Windows or Mac app this page is running in, or null in a browser. */
export function desktopApp(): DesktopApp | null {
  const win = windowsApp();
  if (win) return { platform: 'windows', ...win };
  const v = navigator.userAgent.match(/TunoMac\/([\d.]+)/);
  if (!v) return null;
  return { platform: 'mac', version: v[1], local: false, bridge: macBridge() };
}

type Listener = (e: { data: unknown }) => void;
let mac: ShellBridge | null | undefined;

/**
 * The Mac app listens on window.webkit.messageHandlers.tuno and answers with a "tuno-message" event on window.
 * This wraps both in the same shape as WebView2's channel, so the Settings pages work with either app.
 */
function macBridge(): ShellBridge | null {
  if (mac !== undefined) return mac;
  const handler = (window as unknown as { webkit?: { messageHandlers?: { tuno?: { postMessage(m: unknown): void } } } }).webkit
    ?.messageHandlers?.tuno;
  if (!handler) return (mac = null);
  const wrapped = new Map<Listener, EventListener>();
  mac = {
    postMessage: (m) => handler.postMessage(m),
    addEventListener: (_type, fn) => {
      const l: EventListener = (e) => fn({ data: (e as CustomEvent).detail });
      wrapped.set(fn, l);
      window.addEventListener('tuno-message', l);
    },
    removeEventListener: (_type, fn) => {
      const l = wrapped.get(fn);
      if (!l) return;
      window.removeEventListener('tuno-message', l);
      wrapped.delete(fn);
    },
  };
  return mac;
}
