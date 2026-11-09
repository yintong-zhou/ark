import { useEffect, useSyncExternalStore } from 'react';

/**
 * A native browser view is drawn above the renderer, so any popup that can overlap the page area must hide it
 * (spec §5.2). Popups call `useOverlay()` while mounted; the browser pane reads `useOverlayOpen()`.
 */
let count = 0;
const listeners = new Set<() => void>();
const bump = (by: number) => {
  count += by;
  listeners.forEach((l) => l());
};

export function useOverlay(): void {
  useEffect(() => {
    bump(1);
    return () => bump(-1);
  }, []);
}

export function useOverlayOpen(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => count > 0,
  );
}
