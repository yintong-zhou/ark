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

/** A yes/no kept across restarts (a panel shown or hidden). */
export function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

export function saveFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch { /* not remembered */ }
}
