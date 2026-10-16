import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Resized covers. A list row shows a 40 px picture and a card about 150 px, but the stored cover can be 500 px or much
 * more (some are several MB), so every list used to download full-size images. Clients ask for a width instead
 * (?w=128|256|512) and get a small JPEG made once with ffmpeg and kept in <data>/thumbs.
 */

/** Widths clients may ask for; any other value (or none) means the original image. */
const WIDTHS = [128, 256, 512];
const dir = path.join(config.dataDir, 'thumbs');
fs.mkdirSync(dir, { recursive: true });

export function thumbWidth(value: unknown): number | null {
  const n = Number(value);
  return WIDTHS.includes(n) ? n : null;
}

/** At most two resizes at a time, so opening a big library can't starve downloads and streaming. */
let active = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const inflight = new Map<string, Promise<string | null>>();

/** Path of a resized JPEG copy of an image file (made on first use), or null if it can't be made (send the original then). */
export function thumbnail(src: string, width: number): Promise<string | null> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(src);
  } catch {
    return Promise.resolve(null);
  }
  const key = crypto.createHash('sha1').update(`${src}|${stat.mtimeMs}|${stat.size}`).digest('hex').slice(0, 24);
  const out = path.join(dir, `${key}-${width}.jpg`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  let job = inflight.get(out);
  if (!job) {
    job = limited(
      () =>
        new Promise<string | null>((resolve) => {
          const tmp = `${out}.tmp.jpg`;
          const ff = spawn(config.ffmpeg, ['-nostdin', '-loglevel', 'error', '-y', '-i', src, '-frames:v', '1', '-vf', scaleFilter(width), '-q:v', '5', tmp], {
            stdio: 'ignore',
          });
          const timer = setTimeout(() => ff.kill(), 15_000);
          const done = (ok: boolean) => {
            clearTimeout(timer);
            if (ok && fs.existsSync(tmp)) {
              fs.renameSync(tmp, out);
              resolve(out);
            } else {
              fs.rmSync(tmp, { force: true });
              resolve(null);
            }
          };
          ff.on('error', () => done(false));
          ff.on('close', (code) => done(code === 0));
        }),
    ).finally(() => inflight.delete(out));
    inflight.set(out, job);
  }
  return job;
}

/** Same, for an image held in memory (remote artwork). */
export function thumbnailBuffer(input: Buffer, width: number): Promise<Buffer | null> {
  return limited(
    () =>
      new Promise<Buffer | null>((resolve) => {
        const ff = spawn(config.ffmpeg, ['-nostdin', '-loglevel', 'error', '-i', 'pipe:0', '-frames:v', '1', '-vf', scaleFilter(width), '-q:v', '5', '-f', 'mjpeg', 'pipe:1'], {
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        const chunks: Buffer[] = [];
        const timer = setTimeout(() => ff.kill(), 15_000);
        ff.stdout.on('data', (c: Buffer) => chunks.push(c));
        ff.stdin.on('error', () => {});
        ff.on('error', () => (clearTimeout(timer), resolve(null)));
        ff.on('close', (code) => {
          clearTimeout(timer);
          const out = Buffer.concat(chunks);
          resolve(code === 0 && out.length ? out : null);
        });
        ff.stdin.end(input);
      }),
  );
}

const scaleFilter = (width: number) => `scale='min(${width},iw)':-2`;

/** Thumbnails not touched for 90 days are removed (they're made again on demand). */
export function sweepThumbs() {
  const cutoff = Date.now() - 90 * 86_400_000;
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    }
  } catch {
    /* nothing to sweep */
  }
}

// ---- Fetching remote artwork safely ----

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l.startsWith('::ffff:') && net.isIPv4(l.slice(7))) return isPrivateAddress(l.slice(7));
    return l === '::1' || l === '::' || l.startsWith('fe80') || l.startsWith('fc') || l.startsWith('fd');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** True when the address of this URL is on the public internet (not this server, your LAN or a link-local address). */
export async function isPublicUrl(url: string): Promise<boolean> {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}
