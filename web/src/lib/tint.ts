/** Pages can tint the sticky top bar with their header color. */
export const headerTint = { current: null as string | null, listeners: new Set<() => void>() };

export function setHeaderTint(c: string | null) {
  headerTint.current = c;
  headerTint.listeners.forEach((l) => l());
}
