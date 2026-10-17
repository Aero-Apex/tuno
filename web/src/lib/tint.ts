import { useEffect, useState } from 'react';

/** Pages can tint the sticky top bar with their header color. */
export const headerTint = { current: null as string | null, listeners: new Set<() => void>() };

export function setHeaderTint(c: string | null) {
  headerTint.current = c;
  headerTint.listeners.forEach((l) => l());
}

export function useHeaderTint() {
  const [tint, setTint] = useState(headerTint.current);
  useEffect(() => {
    const l = () => setTint(headerTint.current);
    headerTint.listeners.add(l);
    l();
    return () => void headerTint.listeners.delete(l);
  }, []);
  return tint;
}
