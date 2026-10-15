import { ChevronLeft, ChevronRight, Link2, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { isUrl } from '../lib/format';
import { useUI } from '../store/ui';
import { useAuth } from '../store/auth';
import { LogoMark } from './Logo';

export function TopBar({ scrolled, tint }: { scrolled: boolean; tint?: string | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const openImport = useUI((s) => s.openImport);
  const userInitial = useAuth((s) => s.user?.name.slice(0, 1).toUpperCase() ?? '?');
  const onSearch = location.pathname === '/search';
  const [q, setQ] = useState(onSearch ? params.get('q') ?? '' : '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (onSearch) setQ(params.get('q') ?? '');
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
      navigate(`/search?q=${encodeURIComponent(q.trim())}${tab ? `&tab=${tab}` : ''}`, { replace: true });
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

  return (
    <header
      className="sticky top-0 z-30 flex items-center gap-2 px-4 py-3 transition-colors md:px-6"
      style={{ background: scrolled ? (tint ? `color-mix(in srgb, ${tint} 45%, rgb(var(--c-bg)))` : 'rgb(var(--c-bg))') : 'transparent' }}
    >
      <div className="md:hidden">
        <LogoMark className="h-8 w-8" />
      </div>
      <div className="hidden gap-2 md:flex">
        <button onClick={() => navigate(-1)} className="rounded-full bg-black/40 p-1.5 text-text hover:bg-black/60" aria-label="Back">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button onClick={() => navigate(1)} className="rounded-full bg-black/40 p-1.5 text-text hover:bg-black/60" aria-label="Forward">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <form onSubmit={submit} className="relative mx-auto w-full max-w-xl md:ml-2">
        {isUrl(q) ? (
          <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-accent" />
        ) : (
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        )}
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => !onSearch && !q && navigate('/search')}
          placeholder="Search songs, artists… or paste a link"
          className="h-11 w-full rounded-full bg-elevated pl-11 pr-24 text-sm text-text outline-none ring-text/30 placeholder:text-muted hover:ring-1 focus:ring-2"
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {q && (
            <button type="button" onClick={() => setQ('')} className="icon-btn p-1.5" aria-label="Clear">
              <X className="h-4 w-4" />
            </button>
          )}
          {isUrl(q) && (
            <button type="submit" className="rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-on-accent">
              Download
            </button>
          )}
        </div>
      </form>
      <button onClick={() => openImport()} className="btn-ghost hidden shrink-0 lg:inline-flex" title="Add from link">
        <Link2 className="h-4 w-4" />
        Add link
      </button>
      {/* Phones have no sidebar, so this is their way into Settings and the account. */}
      <button
        onClick={() => navigate('/settings?tab=account')}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-on-accent md:hidden"
        aria-label="Account and settings"
      >
        {userInitial}
      </button>
    </header>
  );
}
