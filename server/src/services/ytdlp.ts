import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { FORMATS, getDownloadSettings } from './limits.js';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  signal?: AbortSignal;
  onLine?: (line: string) => void;
  timeoutMs?: number;
}

/** Netscape-format cookies file, used when YouTube asks to "confirm you're not a bot". */
export const cookiesFile = path.join(config.dataDir, 'cookies.txt');

/** Base flags used for every yt-dlp call. */
function baseArgs(): string[] {
  const args = ['-m', 'yt_dlp', '--no-colors', '--ignore-config', '--js-runtimes', config.jsRuntime];
  if (fs.existsSync(cookiesFile)) args.push('--cookies', cookiesFile);
  return args;
}

export function runYtdlp(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Run at low priority (yt-dlp and the ffmpeg it starts) so downloads never slow the rest of the server.
    const [cmd, cmdArgs] =
      process.platform === 'win32' ? [config.python, [...baseArgs(), ...args]] : ['nice', ['-n', '10', config.python, ...baseArgs(), ...args]];
    const child = spawn(cmd, cmdArgs, {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let buf = '';
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs) : null;
    const onAbort = () => child.kill('SIGKILL');
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (opts.onLine) {
        buf += chunk;
        let idx: number;
        while ((idx = buf.search(/[\r\n]/)) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line) opts.onLine(line);
        }
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Last meaningful error line from yt-dlp's stderr. */
export function ytdlpError(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const err = [...lines].reverse().find((l) => l.startsWith('ERROR'));
  return (err ?? lines.at(-1) ?? 'yt-dlp failed').replace(/^ERROR:\s*/, '').slice(0, 500);
}

export interface FlatEntry {
  id?: string;
  url?: string;
  webpage_url?: string;
  title?: string;
  ie_key?: string;
  uploader?: string;
  channel?: string;
  artists?: string[];
  duration?: number;
  thumbnails?: { url: string; width?: number }[];
}

export interface ProbeResult {
  _type?: string;
  id?: string;
  title?: string;
  extractor_key?: string;
  webpage_url?: string;
  uploader?: string;
  channel?: string;
  artist?: string;
  artists?: string[];
  track?: string;
  album?: string;
  duration?: number;
  thumbnail?: string;
  thumbnails?: { url: string; width?: number }[];
  entries?: (FlatEntry | null)[];
}

/** Quick metadata lookup: tells a single track apart from a playlist and lists the entries. */
export async function probe(url: string, opts: { noPlaylist?: boolean } = {}): Promise<ProbeResult> {
  const res = await runYtdlp(['-J', '--flat-playlist', '--no-warnings', ...(opts.noPlaylist ? ['--no-playlist'] : []), url], {
    timeoutMs: 120_000,
  });
  if (res.code !== 0) {
    const msg = ytdlpError(res.stderr);
    if (/HTTP Error 403/i.test(msg)) throw new Error("That site refuses automated downloads (HTTP 403). Try the song's YouTube, SoundCloud or Spotify link instead.");
    throw new Error(msg);
  }
  return JSON.parse(res.stdout) as ProbeResult;
}

export interface DownloadedInfo {
  id: string;
  title?: string;
  track?: string;
  artist?: string;
  artists?: string[];
  creator?: string;
  uploader?: string;
  channel?: string;
  album?: string;
  duration?: number;
  extractor_key?: string;
  webpage_url?: string;
  filepath?: string;
  thumbnail?: string;
}

const OUTPUT = '%(artist,uploader,channel|Unknown artist).80B/%(track,title).120B [%(id)s].%(ext)s';

/** Downloads one track as audio (keeping the original codec), with cover art and tags embedded. */
export async function downloadAudio(
  url: string,
  onProgress: (pct: number) => void,
  signal: AbortSignal | undefined,
  /** Folder to download into (each account has its own). */
  outDir: string,
): Promise<DownloadedInfo> {
  let info: DownloadedInfo | null = null;
  const limits = getDownloadSettings();
  const args = [
    '--no-playlist',
    // --print would otherwise silence yt-dlp, including the message saying why a video was skipped.
    '--no-quiet',
    // Skip endless uploads (DJ sets, 10-hour loops) and anything huge before it can eat the disk.
    ...(limits.maxMinutes ? ['--match-filter', `duration<=?${limits.maxMinutes * 60} & !is_live`] : ['--match-filter', '!is_live']),
    '--max-filesize',
    '80M',
    // Picks a smaller stream (no re-encoding) depending on the quality setting.
    '-f',
    FORMATS[limits.quality],
    '-x',
    '--embed-metadata',
    // The cover is kept as a separate small file (the app shows that one), not duplicated inside the audio.
    '--write-thumbnail',
    '--convert-thumbnails',
    'jpg',
    // Square crop, at most 500 px: plenty for the app and about a third of the original's size.
    '--ppa',
    `ThumbnailsConvertor+ffmpeg_o:-vf "crop='min(iw,ih)':'min(iw,ih)',scale='min(500,iw)':-2" -q:v 4`,
    '--windows-filenames',
    '--newline',
    '--progress',
    '--progress-template',
    'download:TUNOPROG %(progress._percent_str)s',
    '--print',
    'after_move:TUNOJSON %(.{id,title,track,artist,artists,creator,uploader,channel,album,duration,extractor_key,webpage_url,filepath,thumbnail})j',
    '-P',
    outDir,
    '-o',
    OUTPUT,
    url,
  ];
  const res = await runYtdlp(args, {
    signal,
    onLine: (line) => {
      if (line.startsWith('TUNOPROG')) {
        const pct = parseFloat(line.slice(8).trim());
        if (!Number.isNaN(pct)) onProgress(pct);
      } else if (line.startsWith('TUNOJSON ')) {
        info = JSON.parse(line.slice(9));
      }
    },
  });
  if (signal?.aborted) throw new Error('Canceled');
  if (res.code === 0 && !info) {
    // yt-dlp skips filtered videos without failing; tell the user why nothing was downloaded.
    const out = res.stdout + res.stderr;
    if (/does not pass filter/i.test(out)) throw new Error(`Skipped: longer than ${limits.maxMinutes} minutes (change this in Settings → System)`);
    if (/larger than max-filesize/i.test(out)) throw new Error('Skipped: the file is larger than 80 MB');
    throw new Error(`Skipped: longer than ${limits.maxMinutes || 'the allowed'} minutes or larger than 80 MB`);
  }
  if (res.code !== 0 || !info) throw new Error(ytdlpError(res.stderr));
  return info;
}

export interface StreamInfo {
  url: string;
  protocol: string;
  headers: Record<string, string>;
  ext: string;
}

/** Direct media URL for streaming a result without downloading it. Prefers plain HTTP formats so seeking works. */
export async function resolveStream(url: string): Promise<StreamInfo> {
  const res = await runYtdlp(
    [
      '--no-playlist',
      '--no-warnings',
      '-f',
      'bestaudio[protocol^=http][ext=m4a]/bestaudio[protocol^=http]/bestaudio/best',
      '--print',
      '%(url)s',
      '--print',
      '%(protocol)s',
      '--print',
      '%(ext)s',
      '--print',
      '%(http_headers)j',
      url,
    ],
    { timeoutMs: 60_000 },
  );
  if (res.code !== 0) throw new Error(ytdlpError(res.stderr));
  const [streamUrl, protocol, ext, headers] = res.stdout.trim().split(/\r?\n/);
  return { url: streamUrl, protocol, ext, headers: JSON.parse(headers || '{}') };
}

export async function version(): Promise<string> {
  const res = await runYtdlp(['--version'], { timeoutMs: 30_000 });
  return res.stdout.trim() || 'unknown';
}

export async function update(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.python, ['-m', 'pip', 'install', '-U', '--disable-pip-version-check', 'yt-dlp[default]'], {
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(out.slice(-1000)))));
  });
}

/** Picks the largest thumbnail from a yt-dlp thumbnail list. */
export function bestThumb(thumbs?: { url: string; width?: number }[], fallback?: string): string | undefined {
  if (!thumbs?.length) return fallback;
  const sorted = [...thumbs].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return sorted[0]?.url ?? thumbs.at(-1)?.url ?? fallback;
}
