import fs from 'node:fs';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';
import { HttpError } from '../http.js';

/**
 * Server-wide download limits, set by the admin in Settings → System. They keep the server's disk and CPU
 * safe no matter how many accounts there are or what anyone pastes in.
 */
export type Quality = 'saver' | 'balanced' | 'best';

export interface DownloadSettings {
  /** Which audio stream to pick. Picking a smaller stream costs no CPU: nothing is re-encoded. */
  quality: Quality;
  /** Longer uploads (DJ sets, 10-hour loops) are skipped. 0 = no limit. */
  maxMinutes: number;
  /** Downloads stop while less than this much disk is free, so the server itself never fills up. */
  minFreeGb: number;
}

export const DEFAULT_DOWNLOADS: DownloadSettings = { quality: 'saver', maxMinutes: 30, minFreeGb: 20 };

const QUALITIES: Quality[] = ['saver', 'balanced', 'best'];

export function getDownloadSettings(): DownloadSettings {
  const saved = getSetting<Partial<DownloadSettings>>('downloads', {});
  return {
    quality: QUALITIES.includes(saved.quality as Quality) ? (saved.quality as Quality) : DEFAULT_DOWNLOADS.quality,
    maxMinutes: Number.isFinite(saved.maxMinutes) && saved.maxMinutes! >= 0 ? Math.round(saved.maxMinutes!) : DEFAULT_DOWNLOADS.maxMinutes,
    minFreeGb: Number.isFinite(saved.minFreeGb) && saved.minFreeGb! >= 0 ? saved.minFreeGb! : DEFAULT_DOWNLOADS.minFreeGb,
  };
}

export function saveDownloadSettings(patch: Partial<DownloadSettings>): DownloadSettings {
  const next = { ...getDownloadSettings() };
  if (patch.quality !== undefined) {
    if (!QUALITIES.includes(patch.quality)) throw new HttpError(400, 'Unknown quality');
    next.quality = patch.quality;
  }
  if (patch.maxMinutes !== undefined) {
    if (!Number.isFinite(patch.maxMinutes) || patch.maxMinutes < 0 || patch.maxMinutes > 1440) throw new HttpError(400, 'Invalid maximum length');
    next.maxMinutes = Math.round(patch.maxMinutes);
  }
  if (patch.minFreeGb !== undefined) {
    if (!Number.isFinite(patch.minFreeGb) || patch.minFreeGb < 0 || patch.minFreeGb > 10_000) throw new HttpError(400, 'Invalid free-space limit');
    next.minFreeGb = patch.minFreeGb;
  }
  setSetting('downloads', next);
  return next;
}

/**
 * yt-dlp format selectors, most wanted first. AAC/M4A is preferred because it plays on every device.
 * Quality is chosen by picking a stream YouTube/SoundCloud already offers at that bitrate, never by re-encoding.
 */
export const FORMATS: Record<Quality, string> = {
  // ~50 kbps HE-AAC / ~70 kbps Opus: about 0.4 MB per minute.
  saver: 'bestaudio[abr<=70][ext=m4a]/bestaudio[abr<=70]/bestaudio[abr<=130][ext=m4a]/bestaudio[ext=m4a]/bestaudio/best',
  // ~128 kbps AAC: about 1 MB per minute.
  balanced: 'bestaudio[abr<=130][ext=m4a]/bestaudio[abr<=130]/bestaudio[ext=m4a]/bestaudio/best',
  best: 'bestaudio[ext=m4a]/bestaudio/best',
};

export function diskInfo(): { free: number; total: number } | null {
  try {
    const s = fs.statfsSync(config.libraryDir);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return null; // statfs not available: skip the check rather than block downloads
  }
}

/** Refuses new downloads while the server's disk is nearly full. */
export function assertDiskRoom() {
  const disk = diskInfo();
  if (!disk) return;
  const reserve = getDownloadSettings().minFreeGb * 1024 ** 3;
  if (disk.free < reserve) throw new HttpError(400, 'The server is almost out of disk space, so downloads are paused. Ask the admin to free some space.');
}
