import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { db, getSetting, getUserSetting, setSetting, setUserSetting } from '../db.js';
import { currentUser, requireAdmin } from '../auth.js';
import { cookiesFile, update as updateYtdlp, version as ytdlpVersion } from '../services/ytdlp.js';
import type { SpotifyCreds } from '../services/spotify.js';
import { diskInfo, getDownloadSettings, saveDownloadSettings, type DownloadSettings } from '../services/limits.js';

export default async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async (req) => {
    const user = currentUser(req);
    const spotify = getSetting<SpotifyCreds>('spotify', {});
    return {
      theme: getUserSetting<unknown>(user.id, 'theme', null),
      // Server-wide settings are only shown to the admin.
      spotify: user.isAdmin ? { clientId: spotify.clientId ?? '', hasSecret: !!spotify.clientSecret } : null,
      hasCookies: user.isAdmin ? fs.existsSync(cookiesFile) : false,
    };
  });

  /** Each account has its own theme. */
  app.put('/api/settings/theme', async (req) => {
    setUserSetting(currentUser(req).id, 'theme', req.body);
    return { ok: true };
  });

  app.put('/api/settings/spotify', async (req) => {
    requireAdmin(req);
    const body = req.body as SpotifyCreds;
    const current = getSetting<SpotifyCreds>('spotify', {});
    setSetting('spotify', {
      clientId: body.clientId?.trim() || undefined,
      // An empty secret field means "keep the saved one" unless the Client ID was cleared too.
      clientSecret: body.clientId?.trim() ? body.clientSecret?.trim() || current.clientSecret : undefined,
    });
    return { ok: true };
  });

  app.put('/api/settings/cookies', async (req, reply) => {
    requireAdmin(req);
    const { text } = req.body as { text?: string };
    if (!text?.includes('\t')) return reply.code(400).send({ error: 'That does not look like a Netscape cookies.txt file' });
    fs.writeFileSync(cookiesFile, text.startsWith('# Netscape') ? text : `# Netscape HTTP Cookie File\n${text}`);
    return { ok: true };
  });

  app.delete('/api/settings/cookies', async (req) => {
    requireAdmin(req);
    fs.rmSync(cookiesFile, { force: true });
    return { ok: true };
  });

  app.get('/api/system', async (req) => {
    requireAdmin(req);
    // Sizes come from the database: walking every file of a big library on each request is slow.
    const stats = db
      .prepare('SELECT COUNT(*) AS tracks, COALESCE(SUM(duration),0) AS seconds, COALESCE(SUM(size),0) AS librarySize FROM tracks')
      .get() as { tracks: number; seconds: number; librarySize: number };
    return {
      ytdlp: await ytdlpVersion().catch(() => 'not installed'),
      disk: diskInfo(),
      downloads: getDownloadSettings(),
      ...stats,
    };
  });

  app.put('/api/settings/downloads', async (req) => {
    requireAdmin(req);
    return saveDownloadSettings((req.body ?? {}) as Partial<DownloadSettings>);
  });

  app.post('/api/system/update-ytdlp', async (req, reply) => {
    requireAdmin(req);
    try {
      await updateYtdlp();
      return { ok: true, version: await ytdlpVersion() };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });
}
