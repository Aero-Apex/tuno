import { useEffect, useState } from 'react';
import { rgbToHex } from '../theme/theme';
import { img } from './img';

const cache = new Map<string, string | null>();

/** Picks a vivid, mid-brightness color from an image (same-origin covers only). */
export function extractColor(src: string): Promise<string | null> {
  if (cache.has(src)) return Promise.resolve(cache.get(src)!);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let best: [number, number, number] = [80, 80, 80];
        let bestScore = -1;
        const buckets = new Map<string, { c: [number, number, number]; n: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const key = `${r >> 5},${g >> 5},${b >> 5}`;
          const e = buckets.get(key);
          if (e) {
            e.c[0] += r; e.c[1] += g; e.c[2] += b; e.n++;
          } else buckets.set(key, { c: [r, g, b], n: 1 });
        }
        for (const { c, n } of buckets.values()) {
          const [r, g, b] = [c[0] / n, c[1] / n, c[2] / n];
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const light = (max + min) / 2 / 255;
          const score = n * (0.3 + sat) * (light > 0.12 && light < 0.85 ? 1 : 0.2);
          if (score > bestScore) {
            bestScore = score;
            best = [r, g, b];
          }
        }
        // Keep it readable behind white text.
        const max = Math.max(...best);
        if (max > 200) best = best.map((x) => (x * 200) / max) as [number, number, number];
        if (max < 70) best = best.map((x) => x + (70 - max)) as [number, number, number];
        const hex = rgbToHex(best);
        cache.set(src, hex);
        resolve(hex);
      } catch {
        cache.set(src, null);
        resolve(null);
      }
    };
    img.onerror = () => {
      cache.set(src, null);
      resolve(null);
    };
    img.src = src;
  });
}

export function useCoverColor(raw?: string | null): string | null {
  const src = img(raw, 32); // only the average color is needed, so the smallest size will do
  const [color, setColor] = useState<string | null>(src ? cache.get(src) ?? null : null);
  useEffect(() => {
    let alive = true;
    if (!src || !src.startsWith('/')) {
      setColor(null);
      return;
    }
    extractColor(src).then((c) => alive && setColor(c));
    return () => {
      alive = false;
    };
  }, [src]);
  return color;
}
