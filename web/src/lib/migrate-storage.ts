// The app used to be called Vide. Move this browser's saved theme, queue, recent searches and sort
// order from the old "vide-" keys to "tuno-" ones. Imported first in main.tsx, before any store reads them.
try {
  const old: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('vide-')) old.push(key);
  }
  for (const key of old) {
    const next = 'tuno-' + key.slice(5);
    if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key)!);
    localStorage.removeItem(key);
  }
} catch {
  /* storage unavailable (private mode): nothing to migrate */
}

export {};
