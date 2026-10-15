import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, KeyRound, LogOut, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../components/Dialogs';
import { api, type AdminUser } from '../lib/api';
import { fmtAgo, fmtBytes, plural } from '../lib/format';
import { useAuth } from '../store/auth';
import { useUI } from '../store/ui';

const GB = 1024 ** 3;
const gb = (bytes: number) => +(bytes / GB).toFixed(bytes < GB ? 2 : 1);

/** A bar showing how much of an account's storage limit is used. */
export function QuotaBar({ used, quota, className = '' }: { used: number; quota: number; className?: string }) {
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
  const tone = pct >= 100 ? 'bg-red-500' : pct >= 85 ? 'bg-amber-400' : 'bg-accent';
  return (
    <div className={className}>
      <div className="mb-1.5 flex justify-between text-sm">
        <span>
          <b>{fmtBytes(used)}</b> <span className="text-muted">of {gb(quota)} GB used</span>
        </span>
        <span className={pct >= 100 ? 'font-semibold text-red-400' : 'text-muted'}>{pct >= 100 ? 'Full' : `${fmtBytes(Math.max(0, quota - used))} left`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-text/10">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${Math.max(pct, used ? 1 : 0)}%` }} />
      </div>
    </div>
  );
}

/** Settings → Account: who is signed in, how much space is left, log out. */
export function Account() {
  const { user, logout } = useAuth();
  const { data } = useQuery({ queryKey: ['me'], queryFn: api.me });
  if (!user) return null;
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4 rounded-lg bg-text/5 p-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-2xl font-extrabold text-on-accent">
          {user.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xl font-bold">
            <span className="truncate">{user.name}</span>
            {user.isAdmin && (
              <span className="flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
                <Crown className="h-3.5 w-3.5" /> Admin
              </span>
            )}
          </div>
          <div className="text-sm text-muted">Your songs, playlists and theme are private to this account.</div>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-xl font-bold">Storage</h2>
        <QuotaBar used={data?.used ?? 0} quota={user.quotaBytes} />
        <p className="mt-2 text-sm text-muted">When it's full, new downloads stop. Free up space in the Storage tab.</p>
      </section>

      <button onClick={() => logout()} className="btn-ghost">
        <LogOut className="h-4 w-4" /> Log out
      </button>
    </div>
  );
}

/** Settings → Users (admin): accounts, their passwords and storage limits. */
export function Users() {
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: api.users });
  const me = useAuth((s) => s.user);
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const qc = useQueryClient();
  const { ask, toast } = useUI();

  const remove = (u: AdminUser) =>
    ask({
      title: `Delete “${u.name}”?`,
      body: `This deletes the account and all its ${plural(u.songs, 'song')} (${fmtBytes(u.usedBytes)}) and playlists from the server. It cannot be undone.`,
      confirmLabel: 'Delete account',
      danger: true,
      onConfirm: async () => {
        await api.deleteUser(u.id);
        qc.invalidateQueries({ queryKey: ['users'] });
        toast(`Deleted “${u.name}”`, 'success');
      },
    });

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Accounts</h2>
          <p className="mt-1 text-sm text-muted">Each password opens its own private library with its own storage limit.</p>
        </div>
        <button onClick={() => setEditing('new')} className="btn-accent shrink-0">
          <Plus className="h-4 w-4" /> Add account
        </button>
      </div>

      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="rounded-lg bg-text/5 p-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-text/10 font-bold">{u.name.slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-semibold">
                  <span className="truncate">{u.name}</span>
                  {u.isAdmin && <Crown className="h-4 w-4 shrink-0 text-amber-300" aria-label="Admin" />}
                  {u.id === me?.id && <span className="text-xs font-normal text-muted">(you)</span>}
                </div>
                <div className="text-sm text-muted">
                  {plural(u.songs, 'song')} · {u.lastSeen ? `active ${fmtAgo(u.lastSeen)}` : 'never signed in'}
                </div>
              </div>
              <button onClick={() => setEditing(u)} className="icon-btn" title="Edit" aria-label={`Edit ${u.name}`}>
                <Pencil className="h-4 w-4" />
              </button>
              {u.id !== me?.id && (
                <button onClick={() => remove(u)} className="icon-btn hover:text-red-400" title="Delete account" aria-label={`Delete ${u.name}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <QuotaBar used={u.usedBytes} quota={u.quotaBytes} />
          </div>
        ))}
      </div>

      <UserDialog
        user={editing}
        isSelf={editing !== 'new' && editing?.id === me?.id}
        onClose={() => setEditing(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['users'] });
          qc.invalidateQueries({ queryKey: ['me'] });
          useAuth.getState().check();
        }}
      />
    </div>
  );
}

function UserDialog({ user, isSelf, onClose, onSaved }: { user: AdminUser | 'new' | null; isSelf: boolean; onClose: () => void; onSaved: () => void }) {
  const isNew = user === 'new';
  const existing = isNew ? null : user;
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [quotaGb, setQuotaGb] = useState('1');
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useUI((s) => s.toast);
  const [openFor, setOpenFor] = useState<AdminUser | 'new' | null>(null);

  // Load the form whenever the dialog opens for a (different) account.
  if (user !== openFor) {
    setOpenFor(user);
    setName(existing?.name ?? '');
    setPassword('');
    setQuotaGb(existing ? String(gb(existing.quotaBytes)) : '1');
    setIsAdmin(existing?.isAdmin ?? false);
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isNew) {
        await api.createUser({ name, password, quotaGb: Number(quotaGb), isAdmin });
        toast(`Created “${name}”`, 'success');
      } else if (existing) {
        await api.updateUser(existing.id, { name, password: password || undefined, quotaGb: Number(quotaGb), isAdmin });
        toast(password ? 'Saved. The account was signed out everywhere.' : 'Saved', 'success');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!user} onClose={onClose} title={isNew ? 'Add account' : `Edit “${existing?.name}”`}>
      <form onSubmit={save} className="space-y-4">
        <label className="block">
          <span className="label">Name</span>
          <div className="relative mt-1.5">
            <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="e.g. Guest" className="input pl-9" />
          </div>
        </label>
        <label className="block">
          <span className="label">{isNew ? 'Password' : 'New password'}</span>
          <div className="relative mt-1.5">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={isNew}
              minLength={6}
              autoComplete="new-password"
              placeholder={isNew ? 'At least 6 characters' : 'Leave empty to keep the current one'}
              className="input pl-9 font-mono"
            />
          </div>
          <span className="mt-1 block text-xs text-muted">The password is how this person logs in — each account needs a different one.</span>
        </label>
        <label className="block">
          <span className="label">Storage limit (GB)</span>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={quotaGb}
            onChange={(e) => setQuotaGb(e.target.value)}
            required
            className="input mt-1.5 w-40"
          />
        </label>
        <label className={`flex items-center gap-3 text-sm ${isSelf ? 'opacity-50' : 'cursor-pointer'}`}>
          <input type="checkbox" checked={isAdmin} disabled={isSelf} onChange={(e) => setIsAdmin(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--c-accent))]" />
          Admin (can manage accounts and server settings)
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-subtle">
            Cancel
          </button>
          <button disabled={busy} className="btn-accent">
            {isNew ? 'Create account' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
