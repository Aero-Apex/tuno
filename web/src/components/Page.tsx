import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCoverColor } from '../lib/color';
import { setHeaderTint, useHeaderTint } from '../lib/tint';
import { useTheme } from '../store/theme';
import { AccountButton } from './Account';
import { Cover } from './Cover';

/**
 * The bar pinned to the top of the page: clear over the page's header, then filled with the header's color once you
 * scroll, showing the title (and a play button) after the big header has gone by. On phones it also holds the back
 * button or your avatar.
 */
export function PageBar({
  title,
  onPlay,
  playing,
  avatar,
  back = !avatar,
  solid,
  children,
}: {
  title?: string;
  onPlay?: () => void;
  playing?: boolean;
  avatar?: boolean;
  back?: boolean;
  /** Fill as soon as the page scrolls at all, without waiting for a header to pass. */
  solid?: boolean;
  children?: ReactNode;
}) {
  const tint = useHeaderTint();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [showTitle, setShowTitle] = useState(false);

  // Follows the page's scroll without re-rendering on every frame: the fill fades in as you scroll, and the title shows
  // once the page's own big title has gone under the bar.
  useEffect(() => {
    const main = document.getElementById('main-view');
    const el = ref.current;
    if (!main || !el) return;
    const update = () => {
      const t = main.scrollTop;
      el.style.setProperty('--fill', String(Math.min(1, Math.max(0, solid ? t / 48 : (t - 40) / 180))));
      if (!title) return;
      const h1 = main.querySelector('h1');
      setShowTitle(h1 ? h1.getBoundingClientRect().bottom < main.getBoundingClientRect().top + 64 : t > 260);
    };
    update();
    main.addEventListener('scroll', update, { passive: true });
    return () => main.removeEventListener('scroll', update);
  }, [solid, title]);

  return (
    <div ref={ref} className="sticky top-0 z-30 -mb-16 flex h-16 items-center gap-2 px-4 md:px-6">
      <div
        className="absolute inset-0 -z-10"
        style={{ opacity: 'var(--fill, 0)', background: tint ? `color-mix(in srgb, ${tint} 45%, rgb(var(--c-bg)))` : 'rgb(var(--c-bg))' }}
      />
      {back && (
        <button onClick={() => navigate(-1)} className="-ml-2 rounded-full p-1.5 text-text md:hidden" aria-label="Back">
          <ChevronLeft className="h-7 w-7" />
        </button>
      )}
      {avatar && <AccountButton className="mr-1 md:hidden" />}
      {title && (
        <div className={`flex min-w-0 items-center gap-3 transition-opacity duration-300 ${showTitle ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          {onPlay && <PlayButton size="sm" playing={playing} onClick={onPlay} className="max-md:hidden" />}
          <span className="truncate text-base font-bold md:text-2xl">{title}</span>
        </div>
      )}
      {children}
    </div>
  );
}

export function Page({ children, className = '', bar }: { children: ReactNode; className?: string; bar?: ReactNode }) {
  useEffect(() => setHeaderTint(null), []);
  return (
    <div className="animate-fade-in">
      {bar ?? <PageBar />}
      <div className={`px-4 pb-10 pt-16 md:px-6 ${className}`}>{children}</div>
    </div>
  );
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

/** The color a header is washed in, from its cover (or the given fallback). */
export function useHeaderColor(cover?: string | null, fallback?: string | null) {
  const enabled = useTheme((s) => s.theme.dynamicColor);
  const gradients = useTheme((s) => s.theme.gradientHeaders);
  const extracted = useCoverColor(enabled ? cover : null);
  return gradients ? (enabled ? extracted : null) ?? fallback ?? null : null;
}

/** Big header with the cover's color fading into the page, like an album page. */
export function GradientHeader({ cover, mosaic, coverNode, round, kicker, title, meta, description, color }: HeaderProps) {
  const tint = useHeaderColor(cover ?? mosaic?.[0], color);
  const base = tint ?? 'rgb(var(--c-elevated))';

  useEffect(() => {
    setHeaderTint(tint);
    return () => setHeaderTint(null);
  }, [tint]);

  // Like Spotify, the title shrinks with the room it has (cqw = % of the text column's width) rather than being cut off.
  const fit = title.length > 40 ? 'clamp(1.75rem, 9cqw, 3rem)' : title.length > 16 ? 'clamp(2rem, 14cqw, 4.5rem)' : 'clamp(2rem, 18cqw, 6rem)';
  return (
    <div className="relative px-4 pb-6 pt-16 md:px-6 md:pt-[84px]" style={{ background: `linear-gradient(transparent 0, rgb(0 0 0 / 0.5) 100%), ${base}` }}>
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:gap-6">
        <div className="self-center md:self-auto">
          {coverNode ?? (
            <Cover src={cover} mosaic={mosaic} round={round} className="h-56 w-56 shrink-0 shadow-[0_4px_60px_rgb(0_0_0/0.5)] md:h-[232px] md:w-[232px]" />
          )}
        </div>
        <div className="min-w-0 flex-1 [container-type:inline-size]">
          <div className="hidden text-sm font-medium md:block">{kicker}</div>
          <h1
            className="mt-1 line-clamp-3 break-words text-2xl font-extrabold leading-tight tracking-tight md:mb-3 md:mt-2 md:text-[length:var(--fit)] md:leading-[1.05]"
            style={{ ['--fit' as string]: fit }}
          >
            {title}
          </h1>
          {description && <div className="mt-2 line-clamp-2 text-sm text-text/70">{description}</div>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-x-1 text-sm text-text/90">{meta}</div>}
        </div>
      </div>
    </div>
  );
}

/** The row under a header (play button, shuffle, more…) that carries the header's color down into the page. */
export function ActionBar({ children, tint }: { children: ReactNode; tint?: string | null }) {
  return (
    <div className="relative">
      <div
        className="absolute inset-x-0 top-0 h-60"
        style={{ background: `linear-gradient(rgb(0 0 0 / 0.6) 0, rgb(var(--c-bg)) 100%), ${tint ?? 'rgb(var(--c-elevated))'}` }}
      />
      <div className="relative flex items-center gap-6 px-4 py-6 md:px-6">{children}</div>
    </div>
  );
}

const PLAY_SIZES = { sm: 'h-12 w-12 [&_svg]:h-5 [&_svg]:w-5', md: 'h-12 w-12 [&_svg]:h-5 [&_svg]:w-5', lg: 'h-14 w-14 [&_svg]:h-6 [&_svg]:w-6' };

export function PlayButton({ playing, onClick, size = 'lg', className = '' }: { playing?: boolean; onClick: () => void; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={`flex ${PLAY_SIZES[size]} shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition-transform hover:scale-105 hover:brightness-110 active:scale-95 ${className}`}
      aria-label={playing ? 'Pause' : 'Play'}
    >
      {playing ? <Pause className="fill-current" /> : <Play className="translate-x-px fill-current" />}
    </button>
  );
}

export function Shelf({ title, kicker, to, children }: { title: string; kicker?: string; to?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const update = () => {
    const el = ref.current;
    if (el) setEdges({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(update, [children]);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <section className="mb-6 md:mb-8">
      <div className="mb-1 flex items-end justify-between gap-4">
        <div className="min-w-0">
          {kicker && <div className="text-sm text-muted">{kicker}</div>}
          <h2 className="truncate text-[22px] font-bold tracking-tight md:text-2xl">{to ? <Link to={to} className="hover:underline">{title}</Link> : title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {to && (
            <Link to={to} className="mr-2 text-sm font-bold text-muted hover:underline">
              Show all
            </Link>
          )}
          {!(edges.start && edges.end) && (
            <span className="hidden gap-1 md:flex">
              <button onClick={() => scroll(-1)} disabled={edges.start} className="icon-btn p-1 hover:bg-text/10" aria-label="Scroll left">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button onClick={() => scroll(1)} disabled={edges.end} className="icon-btn p-1 hover:bg-text/10" aria-label="Scroll right">
                <ChevronRight className="h-5 w-5" />
              </button>
            </span>
          )}
        </div>
      </div>
      <div ref={ref} onScroll={update} className="no-scrollbar -mx-3 flex snap-x overflow-x-auto max-md:gap-1">
        {children}
      </div>
    </section>
  );
}

interface CardProps {
  cover?: string | null;
  mosaic?: string[];
  coverNode?: ReactNode;
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

export function Card({ cover, mosaic, coverNode, title, subtitle, to, onClick, onPlay, playing, round, badge, className = '', onContextMenu }: CardProps) {
  const body = (
    <>
      <div className="relative mb-2">
        {coverNode ?? <Cover src={cover} mosaic={mosaic} round={round} className="w-full shadow-[0_8px_24px_rgb(0_0_0/0.5)]" />}
        {badge && <div className="absolute left-2 top-2">{badge}</div>}
        {onPlay && (
          <PlayButton
            size="md"
            playing={playing}
            onClick={onPlay}
            className={`absolute bottom-2 right-2 shadow-[0_8px_8px_rgb(0_0_0/0.3)] transition-all duration-300 max-md:hidden ${
              playing ? 'opacity-100' : 'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100'
            }`}
          />
        )}
      </div>
      <div className={`line-clamp-2 text-[15px] leading-snug ${round ? 'text-center' : ''}`}>{title}</div>
      {subtitle && <div className={`mt-0.5 line-clamp-2 text-sm text-muted ${round ? 'text-center' : ''}`}>{subtitle}</div>}
    </>
  );
  const cls = `group block w-full rounded-md p-3 text-left transition-colors hover:bg-text/[0.07] active:bg-black ${className}`;
  return to ? (
    <Link to={to} className={cls} onContextMenu={onContextMenu}>
      {body}
    </Link>
  ) : (
    // A div, not a <button>, because the card contains its own play button.
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault(); // Space would otherwise scroll the page
        onClick?.();
      }}
      className={`${cls} cursor-pointer`}
    >
      {body}
    </div>
  );
}

export const shelfItem = 'w-[42vw] max-w-[188px] shrink-0 snap-start md:w-[188px]';
export const grid = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 -mx-3';

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 text-text">{icon}</div>
      <h3 className="text-2xl font-bold tracking-tight md:text-[2rem]">{title}</h3>
      {body && <p className="mt-3 max-w-md text-base text-text/90">{body}</p>}
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}
