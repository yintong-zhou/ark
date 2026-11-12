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

/** One of a fixed set of words (a dock side), or the fallback. */
export function loadChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.find((a) => a === v) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveChoice(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch { /* not remembered */ }
}
