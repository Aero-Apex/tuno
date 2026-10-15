import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  submenu?: MenuItem[];
  divider?: boolean;
}

interface Props {
  items: MenuItem[];
  /** Screen position to open at (e.g. from a click or right-click). */
  at: { x: number; y: number } | null;
  onClose: () => void;
}

/** A small floating context menu that keeps itself on screen. */
export function Menu({ items, at, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const [sub, setSub] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!at || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)),
    });
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('resize', onClose);
    };
  }, [at, onClose]);

  if (!at) return null;
  return createPortal(
    <div
      ref={ref}
      style={{ left: pos?.x ?? at.x, top: pos?.y ?? at.y }}
      className="fixed z-[100] min-w-[220px] max-w-[300px] animate-fade-in rounded-md bg-elevated p-1 text-sm shadow-2xl ring-1 ring-black/20"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="my-1 h-px bg-text/10" />
        ) : (
          <div key={i} className="relative" onMouseEnter={() => setSub(item.submenu ? i : null)}>
            <button
              disabled={item.disabled}
              onClick={() => {
                if (item.submenu) return setSub(sub === i ? null : i);
                item.onClick?.();
                onClose();
              }}
              className={`flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors hover:bg-text/10 disabled:opacity-40 ${
                item.danger ? 'text-red-400' : 'text-text'
              }`}
            >
              {item.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">{item.icon}</span>}
              <span className="flex-1 truncate">{item.label}</span>
              {item.submenu && <ChevronRight className="h-4 w-4 text-muted" />}
            </button>
            {item.submenu && sub === i && (
              <div className="absolute left-full top-0 z-10 ml-1 max-h-72 min-w-[200px] overflow-y-auto rounded-md bg-elevated p-1 shadow-2xl ring-1 ring-black/20 max-sm:left-auto max-sm:right-0 max-sm:top-full max-sm:ml-0">
                {item.submenu.map((s, j) =>
                  s.divider ? (
                    <div key={j} className="my-1 h-px bg-text/10" />
                  ) : (
                    <button
                      key={j}
                      onClick={() => {
                        s.onClick?.();
                        onClose();
                      }}
                      className="flex w-full items-center gap-3 truncate rounded-sm px-3 py-2 text-left text-text hover:bg-text/10"
                    >
                      {s.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">{s.icon}</span>}
                      <span className="truncate">{s.label}</span>
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Convenience hook: const menu = useMenu(); <button onClick={menu.open}>; <Menu {...menu.props(items)} /> */
export function useMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAt(null), []);
  return {
    isOpen: !!at,
    open: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setAt({ x: e.clientX, y: e.clientY });
    },
    close,
    props: (items: MenuItem[]) => ({ items, at, onClose: close }),
  };
}
