import { X } from 'lucide-react';
import { useState } from 'react';
import { CHANGELOG } from '../lib/changelog';
import { windowsApp } from '../lib/windows';

const SEEN_KEY = 'tuno-whats-new-version';

/** After an update, shows what changed in the new version. Shown once per version. */
export function WhatsNew() {
  const version = windowsApp()?.version ?? null;
  const entry = version ? CHANGELOG[version] : undefined;
  const [open, setOpen] = useState(() => {
    if (!version || !entry) return false;
    try {
      return localStorage.getItem(SEEN_KEY) !== version;
    } catch {
      return true;
    }
  });
  if (!open || !version || !entry) return null;

  const close = () => {
    try {
      localStorage.setItem(SEEN_KEY, version);
    } catch {
      /* storage unavailable: it will show again next time */
    }
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 md:items-center md:p-6" role="dialog" aria-modal="true" aria-label="What is new">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-elevated shadow-2xl ring-1 ring-text/10 md:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-text/10 p-5">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-accent">New in {version}</div>
            <h2 className="text-2xl font-extrabold tracking-tight">{entry.title}</h2>
          </div>
          <button onClick={close} className="icon-btn shrink-0" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {entry.sections.map((section) => (
            <section key={section.heading}>
              <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted">{section.heading}</h3>
              <ul className="space-y-4">
                {section.items.map((item) => (
                  <li key={item.title} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <div className="min-w-0">
                      <div className="font-semibold">{item.title}</div>
                      {item.text && <div className="mt-0.5 text-sm text-muted">{item.text}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="border-t border-text/10 p-5">
          <button onClick={close} className="btn-accent w-full">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
