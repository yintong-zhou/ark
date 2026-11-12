/** Panel sizes kept across restarts, in localStorage; any failure just means the default size. */
export function loadSize(key: string, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

export function saveSize(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch { /* not remembered */ }
}
