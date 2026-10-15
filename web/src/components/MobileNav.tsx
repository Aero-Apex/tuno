import { Download, Home, Library, Link2, Search } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useUI } from '../store/ui';
import { useActiveJobs } from './Sidebar';

export function MobileNav() {
  const openImport = useUI((s) => s.openImport);
  const active = useActiveJobs();
  const item = 'flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium';
  const cls = ({ isActive }: { isActive: boolean }) => `${item} ${isActive ? 'text-text' : 'text-muted'}`;
  return (
    <nav className="safe-bottom flex bg-gradient-to-t from-surface via-surface/95 to-surface/80 md:hidden">
      <NavLink to="/" end className={cls}>
        <Home className="h-6 w-6" />
        Home
      </NavLink>
      <NavLink to="/search" className={cls}>
        <Search className="h-6 w-6" />
        Search
      </NavLink>
      <button onClick={() => openImport()} className={`${item} text-accent`}>
        <Link2 className="h-6 w-6" />
        Add link
      </button>
      <NavLink to="/library" className={cls}>
        <Library className="h-6 w-6" />
        Library
      </NavLink>
      <NavLink to="/downloads" className={cls}>
        <span className="relative">
          <Download className="h-6 w-6" />
          {active > 0 && (
            <span className="absolute -right-2 -top-1 rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent">{active}</span>
          )}
        </span>
        Downloads
      </NavLink>
    </nav>
  );
}
