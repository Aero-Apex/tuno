import fs from 'node:fs';
import { claimUnownedData, db, type UserRow } from '../db.js';
import { findUserByPassword, hashPassword, toUser, usedBytes, type User } from '../auth.js';
import { badRequest, notFound } from '../http.js';
import { deleteTracks, userLibraryDir } from './library.js';
import { cancelAll } from './queue.js';
import { emit } from './events.js';

const GB = 1024 ** 3;

export function validatePassword(password: unknown, exceptUserId?: number): string {
  if (typeof password !== 'string' || password.length < 6) throw badRequest('Passwords need at least 6 characters');
  // Logging in is by password alone, so two accounts can't share one.
  const owner = findUserByPassword(password);
  if (owner && owner.id !== exceptUserId) throw badRequest('Another account already uses that password');
  return password;
}

export function quotaFromGb(gb: unknown): number {
  const n = Number(gb);
  if (!Number.isFinite(n) || n <= 0 || n > 100_000) throw badRequest('Storage limit must be a number of GB above 0');
  return Math.round(n * GB);
}

export function getUser(id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

/** Creates an account. The very first admin also inherits everything made before accounts existed. */
export function createUser(input: { name: string; password: string; quotaBytes: number; isAdmin: boolean }): User {
  const name = input.name.trim().slice(0, 60) || 'Account';
  validatePassword(input.password);
  const hadAdmin = !!db.prepare('SELECT 1 FROM users WHERE is_admin = 1').get();
  const r = db
    .prepare('INSERT INTO users (name, password_hash, quota_bytes, is_admin, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, hashPassword(input.password), input.quotaBytes, input.isAdmin ? 1 : 0, Date.now());
  const id = Number(r.lastInsertRowid);
  if (input.isAdmin && !hadAdmin) claimUnownedData(id);
  return toUser(getUser(id)!);
}

export function updateUser(id: number, patch: { name?: string; password?: string; quotaBytes?: number; isAdmin?: boolean }): User {
  const user = getUser(id);
  if (!user) throw notFound('Account not found');
  if (patch.isAdmin === false && user.is_admin) {
    const admins = (db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get() as { n: number }).n;
    if (admins <= 1) throw badRequest('There must be at least one admin account');
  }
  const sets: Record<string, unknown> = {};
  if (patch.name?.trim()) sets.name = patch.name.trim().slice(0, 60);
  if (patch.quotaBytes !== undefined) sets.quota_bytes = patch.quotaBytes;
  if (patch.isAdmin !== undefined) sets.is_admin = patch.isAdmin ? 1 : 0;
  if (patch.password !== undefined) sets.password_hash = hashPassword(validatePassword(patch.password, id));
  const keys = Object.keys(sets);
  if (keys.length) db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...sets, id });
  // A new password signs the account out everywhere.
  if (patch.password !== undefined) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  return toUser(getUser(id)!);
}

/** Deletes an account with all its songs (files too), playlists and downloads. */
export function deleteUser(id: number): { freed: number } {
  if (!getUser(id)) throw notFound('Account not found');
  cancelAll(id);
  const ids = (db.prepare('SELECT id FROM tracks WHERE user_id = ?').all(id) as { id: number }[]).map((r) => r.id);
  const { freed } = deleteTracks(ids, null);
  db.prepare('DELETE FROM users WHERE id = ?').run(id); // cascades to sessions, playlists, jobs, settings
  try {
    fs.rmSync(userLibraryDir(id), { recursive: true, force: true });
  } catch {
    /* nothing left */
  }
  emit(id, { type: 'library' });
  return { freed };
}

export function listUsers() {
  const rows = db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM tracks t WHERE t.user_id = u.id) AS songs,
              (SELECT MAX(last_seen) FROM sessions s WHERE s.user_id = u.id) AS last_seen
       FROM users u ORDER BY u.is_admin DESC, u.created_at`,
    )
    .all() as (UserRow & { songs: number; last_seen: number | null })[];
  return rows.map((u) => ({ ...toUser(u), usedBytes: usedBytes(u.id), songs: u.songs, createdAt: u.created_at, lastSeen: u.last_seen }));
}
