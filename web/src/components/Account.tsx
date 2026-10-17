import { useQuery } from '@tanstack/react-query';
import { Bot, Download, HardDrive, Keyboard, Link2, LogOut, Palette, Settings, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtBytes } from '../lib/format';
import { useAuth } from '../store/auth';
import { useUI } from '../store/ui';
import { Menu, useMenu } from './Menu';
import { useActiveJobs } from './Sidebar';

const AVATAR_COLORS = ['#f573a0', '#ff7a4d', '#ffc864', '#9cf0e1', '#b49bc8', '#7fb2ff'];

/** A stable color per name, the same one the Android app picks. */
export function avatarColor(name: string) {
  // Java's String.hashCode, so both apps agree.
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[(h & 0x7fffffff) % AVATAR_COLORS.length];
}

export function Avatar({ name, className = 'h-8 w-8 text-sm' }: { name: string; className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-bold text-black ${className}`} style={{ background: avatarColor(name) }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Your avatar; opens the account menu (account, settings, downloads, log out). */
export function AccountButton({ ring, className = '' }: { ring?: boolean; className?: string }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const menu = useMenu();
  const { data } = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000, enabled: menu.isOpen });
  const active = useActiveJobs();
  if (!user) return null;
  return (
    <>
      <button
        onClick={menu.open}
        className={`relative flex shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105 ${ring ? 'h-12 w-12 bg-elevated' : ''} ${className}`}
        title={active ? `${user.name} · ${active} downloading` : user.name}
        aria-label="Account"
      >
        <Avatar name={user.name} />
        {active > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] font-bold leading-[18px] text-on-accent md:hidden">{active}</span>
        )}
      </button>
      <Menu
        {...menu.props([
          { label: `${user.name} · ${data ? `${fmtBytes(data.used)} of ${fmtBytes(user.quotaBytes)}` : 'Account'}`, icon: <UserRound className="h-4 w-4" />, onClick: () => navigate('/settings?tab=account') },
          { label: 'Assistant', icon: <Bot className="h-4 w-4" />, onClick: () => navigate('/assistant') },
          { label: 'Settings', icon: <Settings className="h-4 w-4" />, onClick: () => navigate('/settings') },
          { label: 'Appearance', icon: <Palette className="h-4 w-4" />, onClick: () => navigate('/settings?tab=appearance') },
          { label: 'Storage', icon: <HardDrive className="h-4 w-4" />, onClick: () => navigate('/settings?tab=storage') },
          { label: active ? `Downloads · ${active} in progress` : 'Downloads', icon: <Download className="h-4 w-4" />, onClick: () => navigate('/downloads') },
          { label: 'Download from link', icon: <Link2 className="h-4 w-4" />, onClick: () => useUI.getState().openImport() },
          { label: 'Keyboard shortcuts', icon: <Keyboard className="h-4 w-4" />, onClick: () => navigate('/settings?tab=shortcuts') },
          { label: '', divider: true },
          { label: 'Log out', icon: <LogOut className="h-4 w-4" />, onClick: () => logout() },
        ])}
      />
    </>
  );
}
