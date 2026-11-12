import type { ThemeMode } from '@shared/types';

/** The theme: `data-theme` on <html> picks the token set in index.css. 'system' follows the OS and its changes. */

const KEY = 'ark-theme'; // last choice, read before the first paint so a light theme does not flash dark
const dark = () => window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();
let mode: ThemeMode = 'system';

/** Runs `cb` after every change of the applied theme (Monaco and xterm keep their own colours). */
export const onThemeApplied = (cb: () => void) => void listeners.add(cb);

export function applyTheme(m: ThemeMode): void {
  mode = m;
  const light = m === 'light' || (m === 'system' && !dark().matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // no storage: the next start reads the saved choice from main
  }
  void window.ark.settings.titleBar(light).catch(() => {});
  listeners.forEach((f) => f());
}

export function initTheme(): void {
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(KEY);
  } catch {
    // no storage
  }
  applyTheme(cached === 'light' || cached === 'dark' ? cached : 'system');
  dark().addEventListener('change', () => mode === 'system' && applyTheme('system'));
  void window.ark.settings.getTheme().then(applyTheme, () => {});
}

export const currentTheme = () => mode;
