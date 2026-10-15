import { useId } from 'react';
import { Link } from 'react-router-dom';

/** The Tuno mark: a "T" whose stem ends in a note head, on a tile tinted with the theme's accent color. */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  // Unique ids so several logos on one page don't share (and fight over) gradient definitions.
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}g`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" style={{ stopColor: 'color-mix(in srgb, rgb(var(--c-accent)) 72%, white)' }} />
          <stop offset="0.55" style={{ stopColor: 'rgb(var(--c-accent))' }} />
          <stop offset="1" style={{ stopColor: 'color-mix(in srgb, rgb(var(--c-accent)) 62%, black)' }} />
        </linearGradient>
        <radialGradient id={`${id}s`} cx="0.3" cy="0.2" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}d`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1.6" stdDeviation="1.4" floodColor="#000" floodOpacity="0.28" />
        </filter>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id}g)`} />
      <rect width="64" height="64" rx="16" fill={`url(#${id}s)`} />
      <path
        filter={`url(#${id}d)`}
        className="fill-on-accent"
        d="M17.5 13h29a4.5 4.5 0 0 1 0 9H42v22.5a10 10 0 1 1-8-9.8V22H17.5a4.5 4.5 0 0 1 0-9z"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <Link to="/" className="inline-flex items-center gap-2.5">
      <LogoMark className="h-9 w-9 drop-shadow-[0_4px_12px_rgb(var(--c-accent)/0.35)]" />
      <span className="text-[1.65rem] font-extrabold tracking-tight">Tuno</span>
    </Link>
  );
}
