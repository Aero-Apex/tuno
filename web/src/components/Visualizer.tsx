import { useEffect, useRef } from 'react';
import { audio } from '../store/player';

let analyser: AnalyserNode | null = null;
let ctx: AudioContext | null = null;

/**
 * Phones suspend Web Audio when the screen locks, and once <audio> is routed through it the music
 * would stop too — so on touch devices the visualizer stays off and playback is never routed.
 */
const isTouchDevice = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/** Routes the shared <audio> element through an analyser once (it can only be connected one time). */
function getAnalyser(): AnalyserNode | null {
  if (isTouchDevice) return null;
  if (analyser) {
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
    return analyser;
  }
  try {
    ctx = new AudioContext();
    const src = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.75;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    return analyser;
  } catch {
    return null;
  }
}

// Keep the audio graph running whenever playback starts.
audio.addEventListener('play', () => {
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
});

export function Visualizer({ className = '', bars = 12 }: { className?: string; bars?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const a = getAnalyser();
    const c = canvas.current;
    if (!a || !c) return;
    const g = c.getContext('2d')!;
    const data = new Uint8Array(a.frequencyBinCount);
    let raf = 0;
    // Reading computed styles every frame is slow; refresh the accent color twice a second.
    let color = '';
    const readColor = () => (color = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim().split(' ').join(','));
    readColor();
    const colorTimer = setInterval(readColor, 500);
    let last = 0;
    const draw = (now = 0) => {
      // Nothing to animate while paused: stop the loop completely (it restarts on 'play').
      if (audio.paused) {
        raf = 0;
        g.clearRect(0, 0, c.width, c.height);
        return;
      }
      raf = requestAnimationFrame(draw);
      if (now - last < 33) return; // ~30 fps is plenty for a few bars
      last = now;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth * dpr;
      const h = c.clientHeight * dpr;
      // Hidden canvases (e.g. the desktop player bar on a phone) have no size; nothing to draw.
      if (w < bars * 3 || h <= 0) return;
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      a.getByteFrequencyData(data);
      g.clearRect(0, 0, w, h);
      g.fillStyle = `rgb(${color})`;
      const gap = 2 * dpr;
      const bw = (w - gap * (bars - 1)) / bars;
      for (let i = 0; i < bars; i++) {
        const v = data[Math.min(data.length - 1, Math.floor((i / bars) * data.length * 0.8))] / 255;
        const bh = Math.max(2 * dpr, v * h);
        g.beginPath();
        g.roundRect(i * (bw + gap), h - bh, bw, bh, Math.max(0, Math.min(bw, bh) / 2));
        g.fill();
      }
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    audio.addEventListener('play', start);
    start();
    return () => {
      audio.removeEventListener('play', start);
      cancelAnimationFrame(raf);
      clearInterval(colorTimer);
    };
  }, [bars]);

  if (isTouchDevice) return null;
  return <canvas ref={canvas} className={className} aria-hidden />;
}
