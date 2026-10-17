import { Bot, ChevronLeft, ChevronRight, Download, Link2, Loader2, MoreHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { isUrl } from '../lib/format';
import { useUI } from '../store/ui';
import { AccountButton } from './Account';
import { BrowseIcon, HomeIcon, SearchIcon } from './Icons';
import { Menu, useMenu } from './Menu';
import { LogoMark } from './Logo';
import { useActiveJobs } from './Sidebar';

/**
 * "What do you want to play?": searches as you type once you're on the search page, and a pasted link turns into a
 * Download button.
 */
export function SearchBox({ variant = 'top' }: { variant?: 'top' | 'page' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const openImport = useUI((s) => s.openImport);
  const onSearch = location.pathname === '/search';
  const [q, setQ] = useState(onSearch ? params.get('q') ?? '' : '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQ(onSearch ? params.get('q') ?? '' : '');
  }, [onSearch, params]);

  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener('tuno:focus-search', focus);
    return () => window.removeEventListener('tuno:focus-search', focus);
  }, []);

  // Search as you type (debounced) once you're on the search page.
  useEffect(() => {
    if (!onSearch || isUrl(q)) return;
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') === q.trim()) return;
      // Keep the selected tab (YouTube, SoundCloud…) while typing.
      const tab = params.get('tab');
      navigate(`/search${q.trim() ? `?q=${encodeURIComponent(q.trim())}${tab ? `&tab=${tab}` : ''}` : ''}`, { replace: true });
    }, 450);
    return () => clearTimeout(t);
  }, [q, onSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    if (isUrl(v)) {
      openImport(v);
      setQ('');
      return;
    }
    navigate(`/search?q=${encodeURIComponent(v)}`);
  };

  const link = isUrl(q);
  const page = variant === 'page';
  return (
    <form onSubmit={submit} className={`group relative w-full ${page ? '' : 'max-w-[474px]'}`} role="search">
      {link ? (
        <Link2 className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-accent ${page ? 'left-3 h-5 w-5' : 'left-3 h-6 w-6'}`} />
      ) : (
        <SearchIcon className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${page ? 'left-3 h-5 w-5 text-bg' : 'left-3 h-6 w-6 text-muted group-focus-within:text-text group-hover:text-text'}`} />
      )}
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => !page && !onSearch && !q && navigate('/search')}
        placeholder={page ? 'What do you want to listen to?' : 'What do you want to play?'}
        aria-label="Search"
        className={
          page
            ? `h-12 w-full rounded-md bg-text pl-11 text-base font-medium text-bg outline-none placeholder:text-bg/60 ${link ? 'pr-28' : q ? 'pr-12' : 'pr-3'}`
            : `h-12 w-full rounded-full bg-elevated pl-12 text-base text-text outline-none ring-text placeholder:text-muted hover:bg-[#2a2a2a] hover:ring-1 hover:ring-text/20 focus:ring-2 focus:ring-text ${link ? 'pr-36' : q ? 'pr-24' : 'pr-16'}`
        }
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {q && (
          <button type="button" onClick={() => setQ('')} className={`rounded-full p-1.5 ${page ? 'text-bg' : 'text-muted hover:text-text'}`} aria-label="Clear search">
            <X className="h-5 w-5" />
          </button>
        )}
        {link ? (
          <button type="submit" className="rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-on-accent">
            Download
          </button>
        ) : (
          !page && (
            <span className="flex items-center border-l border-muted/60 pl-1">
              <button
                type="button"
                onClick={() => navigate('/search')}
                className="p-1.5 pl-2 text-muted transition-transform hover:scale-105 hover:text-text"
                title="Browse"
                aria-label="Browse"
              >
                <BrowseIcon className="h-6 w-6" filled={onSearch && !params.get('q')} />
              </button>
            </span>
          )
        )}
      </div>
    </form>
  );
}

/** The bar across the top of the window on desktop: menu, back/forward, home, search, downloads and your account. */
export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const openImport = useUI((s) => s.openImport);
  const active = useActiveJobs();
  const menu = useMenu();
  const home = location.pathname === '/';

  return (
    <header className="hidden h-16 shrink-0 items-center gap-2 px-2 md:flex">
      <div className="flex flex-1 items-center gap-1 pl-2">
        <LogoMark className="mr-3 h-8 w-8" />
        <button onClick={menu.open} className="icon-btn" title="Menu" aria-label="Menu">
          <MoreHorizontal className="h-6 w-6" />
        </button>
        <button onClick={() => navigate(-1)} className="icon-btn" title="Go back" aria-label="Go back">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button onClick={() => navigate(1)} className="icon-btn" title="Go forward" aria-label="Go forward">
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>
      <div className="flex w-full max-w-[546px] shrink items-center gap-2">
        <button
          onClick={() => navigate('/')}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-elevated transition-transform hover:scale-105 ${home ? 'text-text' : 'text-muted hover:text-text'}`}
          title="Home"
          aria-label="Home"
        >
          <HomeIcon filled={home} className="h-6 w-6" />
        </button>
        <SearchBox />
      </div>
      <div className="flex flex-1 items-center justify-end gap-1">
        <button
          onClick={() => navigate('/assistant')}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold transition-transform hover:scale-105 ${
            location.pathname === '/assistant' ? 'bg-text text-bg' : 'text-muted hover:text-text'
          }`}
          title="Assistant"
          aria-label="Assistant"
        >
          <Bot className="h-4 w-4" /> <span className="hidden lg:inline">Assistant</span>
        </button>
        <button onClick={() => openImport()} className="hidden items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold text-muted transition-transform hover:scale-105 hover:text-text lg:flex" title="Download from link">
          <Link2 className="h-4 w-4" /> Add from link
        </button>
        <button onClick={() => navigate('/downloads')} className={`icon-btn relative ${location.pathname === '/downloads' ? 'text-text' : ''}`} title="Downloads" aria-label="Downloads">
          {active > 0 ? <Loader2 className="h-5 w-5 animate-spin text-accent" /> : <Download className="h-5 w-5" />}
          {active > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] font-bold leading-[18px] text-on-accent">{active}</span>
          )}
        </button>
        <AccountButton ring className="ml-1" />
      </div>
      <Menu
        {...menu.props([
          { label: 'Download from link', icon: <Link2 className="h-4 w-4" />, onClick: () => openImport() },
          { label: 'Assistant', icon: <Bot className="h-4 w-4" />, onClick: () => navigate('/assistant') },
          { label: 'Downloads', icon: <Download className="h-4 w-4" />, onClick: () => navigate('/downloads') },
          { label: 'Your Library', onClick: () => navigate('/library') },
          { label: 'Liked Songs', onClick: () => navigate('/liked') },
          { label: '', divider: true },
          { label: 'Settings', onClick: () => navigate('/settings') },
          { label: 'Keyboard shortcuts', onClick: () => navigate('/settings?tab=shortcuts') },
          { label: 'Reload', onClick: () => window.location.reload() },
        ])}
      />
    </header>
  );
}
