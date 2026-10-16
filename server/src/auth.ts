import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, type UserRow } from './db.js';
import { HttpError } from './http.js';
import { assertDiskRoom } from './services/limits.js';

/**
 * Password-only accounts: each password belongs to exactly one account, and the password you type
 * decides which library you see. Passwords are stored as scrypt hashes; sessions are random tokens
 * kept in an HttpOnly cookie, and only their SHA-256 hash is stored.
 */

export interface User {
  id: number;
  name: string;
  quotaBytes: number;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

const COOKIE = 'tuno_session';
const SESSION_DAYS = 180;

export const toUser = (r: UserRow): User => ({ id: r.id, name: r.name, quotaBytes: r.quota_bytes, isAdmin: !!r.is_admin });

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}

/** The account a password belongs to, if any. */
export function findUserByPassword(password: string): UserRow | undefined {
  const users = db.prepare('SELECT * FROM users').all() as UserRow[];
  return users.find((u) => verifyPassword(password, u.password_hash));
}

const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)').run(tokenHash(token), userId, now, now);
  return token;
}

function readCookie(req: FastifyRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
}

function setCookie(req: FastifyRequest, reply: FastifyReply, value: string, maxAgeSec: number) {
  // Behind Cloudflare the request reaches us as http, but the browser is on https.
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';
  reply.header(
    'set-cookie',
    `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`,
  );
}

export function userFromRequest(req: FastifyRequest): User | undefined {
  const token = readCookie(req, COOKIE);
  if (!token) return;
  const row = db
    .prepare(
      `SELECT u.*, s.last_seen FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.created_at > ?`,
    )
    .get(tokenHash(token), Date.now() - SESSION_DAYS * 86_400_000) as (UserRow & { last_seen: number }) | undefined;
  if (!row) return;
  if (Date.now() - row.last_seen > 3_600_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(Date.now(), tokenHash(token));
  return toUser(row);
}

// ---- Brute-force protection: the site is public, so limit wrong guesses per IP ----
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW = 15 * 60_000;
const MAX_FAILS = 8;

function clientIp(req: FastifyRequest): string {
  return String(req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'] ?? req.ip).split(',')[0].trim();
}

function checkRateLimit(ip: string) {
  const a = attempts.get(ip);
  if (a && Date.now() - a.first < WINDOW && a.count >= MAX_FAILS) {
    const mins = Math.ceil((a.first + WINDOW - Date.now()) / 60_000);
    throw new HttpError(429, `Too many wrong passwords. Try again in ${mins} min.`);
  }
}

function recordFailure(ip: string) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(ip, { count: 1, first: Date.now() });
  else a.count++;
  if (attempts.size > 10_000) attempts.clear();
}

/** Routes anyone may call without logging in (plus /api/app/*, the app update feed). Everything else under /api needs a session. */
const PUBLIC = new Set(['/api/health', '/api/auth/login', '/api/auth/me', '/api/auth/logout']);

export function requireAdmin(req: FastifyRequest): User {
  if (!req.user?.isAdmin) throw new HttpError(403, 'Only the admin account can do that');
  return req.user;
}

/** The signed-in user (routes behind the auth hook always have one). */
export function currentUser(req: FastifyRequest): User {
  if (!req.user) throw new HttpError(401, 'Please log in');
  return req.user;
}

export async function authPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    req.user = userFromRequest(req);
    const path = req.url.split('?')[0];
    if (!req.user && !PUBLIC.has(path) && !path.startsWith('/api/app/')) {
      reply.code(401).send({ error: 'Please log in' });
      return reply;
    }
  });

  app.post('/api/auth/login', async (req, reply) => {
    const ip = clientIp(req);
    checkRateLimit(ip);
    const { password } = (req.body ?? {}) as { password?: unknown };
    if (typeof password !== 'string' || !password) throw new HttpError(400, 'Enter your password');
    const user = findUserByPassword(password);
    if (!user) {
      recordFailure(ip);
      await new Promise((r) => setTimeout(r, 400)); // slow down guessing a little more
      throw new HttpError(401, 'Wrong password');
    }
    attempts.delete(ip);
    setCookie(req, reply, createSession(user.id), SESSION_DAYS * 86_400);
    return { user: toUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = readCookie(req, COOKIE);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
    setCookie(req, reply, '', 0);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Please log in' });
    const used = (db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM tracks WHERE user_id = ?').get(req.user.id) as { used: number }).used;
    return { user: req.user, used };
  });
}

/** Bytes of music an account currently stores. */
export function usedBytes(userId: number): number {
  return (db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM tracks WHERE user_id = ?').get(userId) as { used: number }).used;
}

/** Throws a friendly error when an account has no room left for more downloads. */
export function assertHasRoom(userId: number) {
  assertDiskRoom(); // the server's own disk, no matter whose account this is
  const user = db.prepare('SELECT quota_bytes FROM users WHERE id = ?').get(userId) as { quota_bytes: number } | undefined;
  if (!user) throw new HttpError(401, 'Please log in');
  if (usedBytes(userId) >= user.quota_bytes) {
    throw new HttpError(
      400,
      `Your storage is full (${formatGb(user.quota_bytes)} limit). Delete some songs in Settings → Storage to download more.`,
    );
  }
}

export const formatGb = (bytes: number) =>
  bytes < 1024 ** 3 ? `${Math.round(bytes / 1024 ** 2)} MB` : `${+(bytes / 1024 ** 3).toFixed(1)} GB`;
