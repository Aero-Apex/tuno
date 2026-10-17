import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { db, getUserSetting } from '../db.js';
import { HttpError } from '../http.js';
import { addToPlaylist, createPlaylist } from './library.js';
import { importUrl } from './queue.js';
import { search, type SearchSource } from './search.js';

/**
 * The in-app assistant. It talks to an OpenAI-compatible chat endpoint and can use a few tools:
 * reading the account's library (always allowed) and proposing changes (playlists, downloads).
 * Changes wait in `pending` until the account approves them, unless that account turned on bypass.
 */

type Args = Record<string, unknown>;
interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
interface Msg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface PendingView {
  id: string;
  description: string;
}
interface Pending {
  id: string;
  userId: number;
  name: string;
  args: Args;
  description: string;
  at: number;
}

const SYSTEM = `You are the assistant inside Tuno, a self-hosted music app. You can read the user's library and playlists, search for music, and propose changes: creating or editing playlists and downloading songs.
Every change waits for the user's approval unless they turned that off, so say what you proposed in a sentence or two.
Look at search_library or list_playlists before suggesting songs, and only use track ids those tools returned.
Keep replies short and plain.`;

const SEARCH_SOURCES = ['youtube', 'ytmusic', 'soundcloud', 'spotify'];

/** Tools as the model sees them. `action` tools change something and need approval. */
const TOOLS = [
  {
    name: 'search_library',
    description: "Find songs in the user's library. An empty query gives the most played and newest songs.",
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } },
    },
  },
  {
    name: 'list_playlists',
    description: "List the user's playlists with how many songs each has.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_playlist',
    description: "List the songs in one of the user's playlists.",
    parameters: { type: 'object', properties: { playlistId: { type: 'integer' } }, required: ['playlistId'] },
  },
  {
    name: 'search_music',
    description: 'Search an online source for songs and playlists that may not be downloaded yet.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, source: { type: 'string', enum: SEARCH_SOURCES } },
      required: ['query', 'source'],
    },
  },
  {
    name: 'create_playlist',
    description: 'Create a playlist from songs in the library. Needs the user\'s approval.',
    action: true,
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' }, trackIds: { type: 'array', items: { type: 'integer' } } },
      required: ['name', 'trackIds'],
    },
  },
  {
    name: 'add_to_playlist',
    description: "Add songs from the library to one of the user's playlists. Needs the user's approval.",
    action: true,
    parameters: {
      type: 'object',
      properties: { playlistId: { type: 'integer' }, trackIds: { type: 'array', items: { type: 'integer' } } },
      required: ['playlistId', 'trackIds'],
    },
  },
  {
    name: 'download_song',
    description: 'Download a song, album or playlist from a link that search_music returned. Needs the user\'s approval.',
    action: true,
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
];

const ACTIONS = new Set(TOOLS.filter((t) => t.action).map((t) => t.name));

const pending = new Map<string, Pending>();

function sweepPending() {
  const cutoff = Date.now() - 60 * 60_000;
  for (const [id, p] of pending) if (p.at < cutoff) pending.delete(id);
}

const clampInt = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

/** Track ids the account owns, without repeats. Anything else is dropped. */
function ownedTrackIds(userId: number, value: unknown): number[] {
  const own = db.prepare('SELECT 1 FROM tracks WHERE id = ? AND user_id = ?');
  const ids = Array.isArray(value) ? [...new Set(value.map(Number).filter(Number.isInteger))].slice(0, 500) : [];
  return ids.filter((id) => own.get(id, userId));
}

function ownedPlaylist(userId: number, value: unknown): { id: number; name: string } {
  const id = Number(value);
  const p = db.prepare('SELECT id, name FROM playlists WHERE id = ? AND user_id = ?').get(id, userId) as { id: number; name: string } | undefined;
  if (!p) throw new Error('That playlist is not in this account');
  return p;
}

/** The read-only tools. They run straight away. */
const READ: Record<string, (userId: number, a: Args) => unknown | Promise<unknown>> = {
  search_library: (userId, a) => {
    const q = String(a.query ?? '').trim().replace(/[%_]/g, '');
    const like = `%${q}%`;
    return db
      .prepare(
        `SELECT id, title, artist, album, duration FROM tracks WHERE user_id = ? AND (? = '' OR title LIKE ? OR artist LIKE ? OR album LIKE ?)
         ORDER BY play_count DESC, added_at DESC LIMIT ?`,
      )
      .all(userId, q, like, like, like, clampInt(a.limit, 100, 1, 200));
  },
  list_playlists: (userId) =>
    db
      .prepare(
        `SELECT p.id, p.name, COUNT(pt.track_id) AS songs FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id WHERE p.user_id = ? GROUP BY p.id ORDER BY p.name`,
      )
      .all(userId),
  get_playlist: (userId, a) => {
    const p = ownedPlaylist(userId, a.playlistId);
    const tracks = db
      .prepare(
        `SELECT t.id, t.title, t.artist FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = ? ORDER BY pt.position, pt.rowid LIMIT 300`,
      )
      .all(p.id);
    return { id: p.id, name: p.name, tracks };
  },
  search_music: async (userId, a) => {
    const source = String(a.source) as SearchSource;
    if (!SEARCH_SOURCES.includes(source)) throw new Error(`Unknown source ${source}`);
    const results = await search(String(a.query ?? '').trim(), source, userId);
    return results.slice(0, 10).map((r) => ({
      kind: r.kind,
      title: r.title,
      artist: r.artist,
      source: r.source,
      url: r.url,
      libraryTrackId: r.trackId ?? undefined,
    }));
  },
};

function describe(userId: number, name: string, a: Args): string {
  if (name === 'create_playlist') {
    const count = ownedTrackIds(userId, a.trackIds).length;
    return `Create the playlist “${String(a.name ?? '').trim().slice(0, 200) || 'New playlist'}” with ${count} ${count === 1 ? 'song' : 'songs'}`;
  }
  if (name === 'add_to_playlist') {
    const p = ownedPlaylist(userId, a.playlistId);
    const count = ownedTrackIds(userId, a.trackIds).length;
    return `Add ${count} ${count === 1 ? 'song' : 'songs'} to “${p.name}”`;
  }
  return `Download ${String(a.url ?? '')}`;
}

async function executeAction(userId: number, name: string, a: Args): Promise<unknown> {
  if (name === 'create_playlist') {
    const ids = ownedTrackIds(userId, a.trackIds);
    const id = createPlaylist(userId, String(a.name ?? '').trim().slice(0, 200) || 'New playlist');
    for (const tid of ids) addToPlaylist(id, tid);
    return { playlistId: id, added: ids.length };
  }
  if (name === 'add_to_playlist') {
    const p = ownedPlaylist(userId, a.playlistId);
    const ids = ownedTrackIds(userId, a.trackIds);
    for (const tid of ids) addToPlaylist(p.id, tid);
    return { playlistId: p.id, added: ids.length };
  }
  if (name === 'download_song') {
    const url = String(a.url ?? '').trim();
    if (!url) throw new Error('Missing link');
    return importUrl(userId, url);
  }
  throw new Error(`Unknown action ${name}`);
}

async function runTool(userId: number, name: string, a: Args, bypass: boolean, pendingOut: PendingView[], doneOut: { description: string; result: unknown }[]): Promise<unknown> {
  try {
    const read = READ[name];
    if (read) return await read(userId, a);
    if (!ACTIONS.has(name)) return { error: `There is no tool called ${name}` };
    const description = describe(userId, name, a);
    if (bypass) {
      const result = await executeAction(userId, name, a);
      doneOut.push({ description, result });
      return { ok: true, result };
    }
    const id = randomUUID();
    pending.set(id, { id, userId, name, args: a, description, at: Date.now() });
    pendingOut.push({ id, description });
    return { status: 'waiting_for_approval', note: 'Shown to the user with Approve and Reject buttons. Do not repeat it; say what you proposed.' };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function parseArgs(raw: string): Args {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? (v as Args) : {};
  } catch {
    return {};
  }
}

async function callModel(messages: Msg[]): Promise<Msg> {
  if (!config.aiKey) throw new HttpError(503, 'The assistant is not set up on this server yet (it needs a TUNO_AI_KEY).');
  let res: Response;
  try {
    res = await fetch(`${config.aiUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.aiKey}` },
      body: JSON.stringify({
        model: config.aiModel,
        messages,
        tools: TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
        tool_choice: 'auto',
        max_tokens: 1500,
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new HttpError(502, 'The assistant could not be reached. Try again in a moment.');
  }
  const text = await res.text();
  let data: { choices?: { message?: Msg }[]; error?: { message?: string } } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  const msg = data?.choices?.[0]?.message;
  if (!res.ok || !msg) throw new HttpError(502, `The assistant service said: ${data?.error?.message ?? `HTTP ${res.status}`}`);
  return msg;
}

/** Runs one request: the model may call tools for several rounds, then answers in text. Proposed changes come back as `pending`. */
export async function chat(userId: number, history: { role: 'user' | 'assistant'; content: string }[]) {
  sweepPending();
  const bypass = getUserSetting<boolean>(userId, 'assistantBypass', false);
  const convo: Msg[] = [{ role: 'system', content: SYSTEM }, ...history];
  const pendingOut: PendingView[] = [];
  const doneOut: { description: string; result: unknown }[] = [];

  for (let step = 0; step < 8; step++) {
    const msg = await callModel(convo);
    convo.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
    if (!msg.tool_calls?.length) {
      return { reply: msg.content?.trim() || 'Done.', pending: pendingOut, done: doneOut, bypass };
    }
    for (const call of msg.tool_calls) {
      const out = await runTool(userId, call.function.name, parseArgs(call.function.arguments), bypass, pendingOut, doneOut);
      convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out).slice(0, 20_000) });
    }
  }
  return { reply: 'That took too many steps. Try a smaller request.', pending: pendingOut, done: doneOut, bypass };
}

/** Takes a waiting change out of the queue, if it belongs to this account. */
function takePending(userId: number, id: string): Pending {
  sweepPending();
  const p = pending.get(id);
  if (!p || p.userId !== userId) throw new HttpError(404, 'That change is no longer waiting for approval');
  pending.delete(id);
  return p;
}

export async function approveAction(userId: number, id: string) {
  const p = takePending(userId, id);
  const result = await executeAction(userId, p.name, p.args);
  return { ok: true, description: p.description, result };
}

export function rejectAction(userId: number, id: string) {
  takePending(userId, id);
  return { ok: true };
}
