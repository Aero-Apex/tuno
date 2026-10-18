import { itemArtist, itemDuration, itemTitle, usePlayer } from '../store/player';
import { windowsApp } from './windows';

/**
 * Tells the Windows app what's playing, so Discord can show it. Sends only when the song or the play state changes,
 * or when playback jumps (a seek), not on every progress tick.
 */
export function startNowPlayingBridge() {
  const bridge = windowsApp()?.bridge;
  if (!bridge) return;
  let lastKey = '';
  let lastAt = 0;
  let lastTime = 0;
  usePlayer.subscribe((s) => {
    const cur = s.queue[s.index];
    const key = `${cur?.qid ?? ''}|${s.playing}`;
    const now = Date.now();
    const expected = lastTime + (s.playing ? (now - lastAt) / 1000 : 0);
    const jumped = Math.abs(s.time - expected) > 3;
    if (key === lastKey && !jumped) return;
    lastKey = key;
    lastAt = now;
    lastTime = s.time;
    bridge.postMessage({
      type: 'now-playing',
      title: itemTitle(cur),
      artist: itemArtist(cur),
      playing: s.playing && !!cur,
      position: s.time,
      duration: s.duration || itemDuration(cur) || 0,
    });
  });
}
