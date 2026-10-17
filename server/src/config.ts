import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(process.env.TUNO_ROOT ?? process.cwd());

// Optional local overrides (KEY=value lines) in server/.env — handy for development.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export const config = {
  port: Number(process.env.PORT ?? 7070),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(process.env.TUNO_DATA ?? path.join(root, '..', 'data')),
  libraryDir: path.resolve(process.env.TUNO_LIBRARY ?? path.join(root, '..', 'library')),
  webDist: path.resolve(process.env.TUNO_WEB ?? path.join(root, '..', 'web', 'dist')),
  /** Python interpreter that has yt-dlp installed; we always run `python -m yt_dlp`. */
  python: process.env.YTDLP_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'),
  /** JS runtime yt-dlp uses to solve YouTube challenges (needs Node 22+), e.g. "node" or "node:/path/to/node". */
  jsRuntime: process.env.YTDLP_JS_RUNTIME ?? 'node',
  ffmpeg: process.env.FFMPEG ?? 'ffmpeg',
  concurrency: Number(process.env.TUNO_CONCURRENCY ?? 3),
  /** The assistant's model: an OpenAI-compatible chat endpoint (base URL, key and model name). Off when the key is missing. */
  aiUrl: (process.env.TUNO_AI_URL ?? 'https://euromodels.xyz/v1').replace(/\/$/, ''),
  aiKey: process.env.TUNO_AI_KEY ?? '',
  aiModel: process.env.TUNO_AI_MODEL ?? 'euromodels/claude-opus-5.5',
};

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.libraryDir, { recursive: true });
