import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCoverColor } from '../lib/color';
import { setHeaderTint } from '../lib/tint';
import { useTheme } from '../store/theme';
import { Cover } from './Cover';

export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  useEffect(() => setHeaderTint(null), []);
  return <div className={`animate-fade-in px-4 pb-10 pt-[84px] md:px-6 ${className}`}>{children}</div>;
}

interface HeaderProps {
  cover?: string | null;
  mosaic?: string[];
  coverNode?: ReactNode;
  round?: boolean;
  kicker: string;
  title: string;
  meta?: ReactNode;
  description?: ReactNode;
  /** Fallback tint when the cover has no readable color. */
  color?: string | null;
}

/** Big header with the cover's color fading into the page, like an album page. */
export function GradientHeader({ cover, mosaic, coverNode, round, kicker, title, meta, description, color }: HeaderProps) {
  const enabled = useTheme((s) => s.theme.dynamicColor);
  const gradients = useTheme((s) => s.theme.gradientHeaders);
  const extracted = useCoverColor(enabled ? cover ?? mosaic?.[0] : null);
  const tint = gradients ? (enabled ? extracted : null) ?? color ?? null : null;

  useEffect(() => {
    setHeaderTint(tint);
    return () => setHeaderTint(null);
  }, [tint]);

  return (
    <div
      className="relative px-4 pb-6 pt-[92px] md:px-6"
      style={{
        background: !gradients ? undefined : `linear-gradient(to bottom, ${tint ?? 'rgb(var(--c-elevated))'} 0%, color-mix(in srgb, ${
          tint ?? 'rgb(var(--c-elevated))'
        } 35%, rgb(var(--c-bg))) 100%)`,
      }}
    >
      <div className="flex flex-col items-center gap-6 md:flex-row md:items-end">
        {coverNode ?? <Cover src={cover} mosaic={mosaic} round={round} className="h-48 w-48 shrink-0 shadow-2xl md:h-56 md:w-56" />}
        <div className="min-w-0 text-center md:text-left">
          <div className="text-sm font-semibold">{kicker}</div>
          <h1
            className="mt-1 line-clamp-2 break-words font-extrabold leading-none tracking-tight"
            style={{ fontSize: `clamp(2rem, ${title.length > 30 ? 4 : 6.5}vw, ${title.length > 30 ? 3.5 : 5.5}rem)` }}
          >
            {title}
          </h1>
          {description && <div className="mt-3 line-clamp-2 text-sm text-text/70">{description}</div>}
          {meta && <div className="mt-3 flex flex-wrap items-center justify-center gap-x-1.5 text-sm text-text/90 md:justify-start">{meta}</div>}
        </div>
      </div>
    </div>
  );
}

export function ActionBar({ children, tint }: { children: ReactNode; tint?: string | null }) {
  return (
    <div
      className="relative flex items-center gap-4 px-4 py-5 md:px-6"
      style={{ background: tint ? `linear-gradient(to bottom, color-mix(in srgb, ${tint} 20%, transparent), transparent)` : undefined }}
    >
      {children}
    </div>
  );
}

export function PlayButton({ playing, onClick, size = 'lg', className = '' }: { playing?: boolean; onClick: () => void; size?: 'md' | 'lg'; className?: string }) {
  const dim = size === 'lg' ? 'h-14 w-14' : 'h-12 w-12';
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full bg-accent text-on-accent shadow-xl transition-transform hover:scale-105 active:scale-95 ${className}`}
      aria-label={playing ? 'Pause' : 'Play'}
    >
      {playing ? <Pause className="h-6 w-6 fill-current" /> : <Play className="h-6 w-6 translate-x-0.5 fill-current" />}
    </button>
  );
}

export function Shelf({ title, to, children }: { title: string; to?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">{to ? <Link to={to} className="hover:underline">{title}</Link> : title}</h2>
        <div className="hidden gap-1 md:flex">
          {to && (
            <Link to={to} className="mr-2 self-center text-sm font-semibold text-muted hover:text-text hover:underline">
              Show all
            </Link>
          )}
          <button onClick={() => scroll(-1)} className="icon-btn hover:bg-text/10" aria-label="Scroll left">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button onClick={() => scroll(1)} className="icon-btn hover:bg-text/10" aria-label="Scroll right">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div ref={ref} className="no-scrollbar -mx-3 flex snap-x gap-1 overflow-x-auto px-0">
        {children}
      </div>
    </section>
  );
}

interface CardProps {
  cover?: string | null;
  mosaic?: string[];
  title: string;
  subtitle?: ReactNode;
  to?: string;
  onClick?: () => void;
  onPlay?: () => void;
  playing?: boolean;
  round?: boolean;
  badge?: ReactNode;
  className?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function Card({ cover, mosaic, title, subtitle, to, onClick, onPlay, playing, round, badge, className = '', onContextMenu }: CardProps) {
  const body = (
    <>
      <div className="relative mb-3">
        <Cover src={cover} mosaic={mosaic} round={round} className="w-full" />
        {badge && <div className="absolute left-2 top-2">{badge}</div>}
        {onPlay && (
          <PlayButton
            size="md"
            playing={playing}
            onClick={onPlay}
            className={`absolute bottom-2 right-2 transition-all ${
              playing ? 'opacity-100' : 'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 max-md:hidden'
            }`}
          />
        )}
      </div>
      <div className={`truncate font-semibold ${round ? 'text-center' : ''}`}>{title}</div>
      {subtitle && <div className={`mt-1 line-clamp-2 text-sm text-muted ${round ? 'text-center' : ''}`}>{subtitle}</div>}
    </>
  );
  const cls = `group card block w-full text-left ${className}`;
  return to ? (
    <Link to={to} className={cls} onContextMenu={onContextMenu}>
      {body}
    </Link>
  ) : (
    // A div, not a <button>, because the card contains its own play button.
    <div role="button" tabIndex={0} onClick={onClick} onContextMenu={onContextMenu} onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault(); // Space would otherwise scroll the page
        onClick?.();
      }} className={`${cls} cursor-pointer`}>
      {body}
    </div>
  );
}

export const shelfItem = 'w-[44vw] max-w-[200px] shrink-0 snap-start sm:w-48';
export const grid = 'grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 -mx-3';

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 text-muted">{icon}</div>
      <h3 className="text-xl font-bold">{title}</h3>
      {body && <p className="mt-2 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
