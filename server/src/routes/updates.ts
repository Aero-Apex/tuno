import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { badRequest, notFound } from '../http.js';

/**
 * Self-update feed for the Android and Windows apps. Builds are published into <data>/updates with
 * scripts/publish-update.ps1: a <platform>.json manifest plus the file it names. Nothing here is account data
 * (anyone could download the same apps from a release page), so these routes skip the login check.
 *
 * The apps verify what they download: Android checks the APK's checksum and signing certificate, Windows checks the
 * checksum and an ECDSA signature made with a key that never leaves the developer's PC, so a compromised server
 * can't push code to the apps.
 */

const PLATFORMS = new Set(['android', 'windows']);
const updatesDir = () => path.join(config.dataDir, 'updates');

interface Manifest {
  version: string;
  versionCode?: number;
  file: string;
  sha256: string;
  size: number;
  signature?: string;
  notes?: string;
}

function readManifest(platform: string): Manifest | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(updatesDir(), `${platform}.json`), 'utf8')) as Manifest;
    // The manifest names a file inside the updates folder, never a path.
    if (!m.file || path.basename(m.file) !== m.file || !fs.existsSync(path.join(updatesDir(), m.file))) return null;
    return m;
  } catch {
    return null;
  }
}

function platformOf(req: { query?: unknown; params?: unknown }): string {
  const p = String(((req.query ?? {}) as { platform?: string }).platform ?? ((req.params ?? {}) as { platform?: string }).platform ?? '');
  if (!PLATFORMS.has(p)) throw badRequest('platform must be android or windows');
  return p;
}

export default async function updateRoutes(app: FastifyInstance) {
  app.get('/api/app/latest', async (req, reply) => {
    const platform = platformOf(req);
    const m = readManifest(platform);
    if (!m) throw notFound('No update has been published');
    reply.header('cache-control', 'no-cache');
    return { ...m, url: `/api/app/download/${platform}` };
  });

  app.get('/api/app/download/:platform', async (req, reply) => {
    const platform = platformOf(req);
    const m = readManifest(platform);
    if (!m) throw notFound('No update has been published');
    reply
      .header('cache-control', 'no-cache')
      .header('content-disposition', `attachment; filename="${m.file}"`)
      .type(platform === 'android' ? 'application/vnd.android.package-archive' : 'application/vnd.microsoft.portable-executable');
    return reply.sendFile(m.file, updatesDir());
  });
}
