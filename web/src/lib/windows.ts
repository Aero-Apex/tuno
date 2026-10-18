/**
 * The Windows app is this same page inside its WebView2 window. The window says so in the user agent
 * ("TunoWindows/1.1.6", plus "TunoLocal" when Tuno runs on this PC) and exposes a message channel.
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
