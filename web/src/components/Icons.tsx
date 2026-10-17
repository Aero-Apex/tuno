/** A few icons drawn for Tuno where the icon set has no filled/outlined pair. */
type P = { className?: string; filled?: boolean };

export function HomeIcon({ className = 'h-6 w-6', filled }: P) {
  return filled ? (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12.6 2.3a1 1 0 0 0-1.2 0l-8 6.2A1 1 0 0 0 3 9.3V21a1 1 0 0 0 1 1h5.5v-6.5a2.5 2.5 0 0 1 5 0V22H20a1 1 0 0 0 1-1V9.3a1 1 0 0 0-.4-.8z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M4 9.6 12 3.4l8 6.2V21h-5v-5.5a3 3 0 0 0-6 0V21H4z" />
    </svg>
  );
}

export function LibraryIcon({ className = 'h-6 w-6', filled }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={filled ? 2.6 : 2} strokeLinecap="round" aria-hidden>
      <path d="M4 3v18M9 3v18" />
      <path d="m14 3.5 6.2 16.8" />
    </svg>
  );
}

export function SearchIcon({ className = 'h-6 w-6', filled }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={filled ? 3 : 2} strokeLinecap="round" aria-hidden>
      <circle cx="10.5" cy="10.5" r="7" />
      <path d="m16 16 5.5 5.5" />
    </svg>
  );
}

/** The "browse" box in the search bar. */
export function BrowseIcon({ className = 'h-6 w-6', filled }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M3 8.5 5 3h14l2 5.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" fill={filled ? 'currentColor' : 'none'} />
      <path d="M3 8.5h18" stroke={filled ? 'rgb(var(--c-surface))' : 'currentColor'} />
      <path d="M9 13h6" stroke={filled ? 'rgb(var(--c-surface))' : 'currentColor'} strokeLinecap="round" />
    </svg>
  );
}

/** Opens and closes the playing-song panel on the right. */
export function NowPlayingViewIcon({ className = 'h-4 w-4' }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="2.5" width="18" height="19" rx="2.5" />
      <path d="M3 17h18" />
      <path d="M10 6.5v6l5-3z" fill="currentColor" />
    </svg>
  );
}
