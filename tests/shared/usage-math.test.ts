import { expect, test } from 'vitest';
import { formatAge, formatDuration, mergeWindow, moveWindows, pickWindows, sessionState, staleAge, windowView } from '@shared/usage-math';

const NOW = 1_793_878_800_000;
const S = NOW / 1000;

test('pickWindows by duration, weekly as primary', () => {
  const w = pickWindows([
    { usedPct: 71, resetsAt: S + 1, minutes: 10080 },
    { usedPct: 21, resetsAt: S + 2, minutes: 300 },
  ]);
  expect(w.fiveHour?.usedPct).toBe(21);
  expect(w.weekly?.usedPct).toBe(71);
});

test('mergeWindow keeps later reset, ties go to next', () => {
  const a = { usedPct: 40, resetsAt: S + 100, minutes: 300 };
  const old = { usedPct: 90, resetsAt: S - 100, minutes: 300 };
  expect(mergeWindow(a, old)).toBe(a);
  expect(mergeWindow(a, { ...a, usedPct: 45 })?.usedPct).toBe(45);
  expect(mergeWindow(undefined, a)).toBe(a);
});

test('mergeWindow treats reset jitter as the same window and keeps the higher usage', () => {
  const fresh = { usedPct: 18, resetsAt: S + 1000, minutes: 10080 }; // live app-server reading
  const stale = { usedPct: 8, resetsAt: S + 1002, minutes: 10080 }; // older rollout, same window, +2 s jitter
  expect(mergeWindow(fresh, stale)?.usedPct).toBe(18);
  expect(mergeWindow(stale, fresh)?.usedPct).toBe(18);
});

test('windowView: reset when past, pace on weekly only', () => {
  expect(windowView({ usedPct: 62, resetsAt: S - 1, minutes: 300 }, NOW)).toEqual({ kind: 'reset' });
  const wk = windowView({ usedPct: 38, resetsAt: S + 4 * 86400 + 6 * 3600, minutes: 10080 }, NOW);
  expect(wk).toMatchObject({ kind: 'live', pct: 38, resetIn: 4 * 86400 + 6 * 3600 });
  expect((wk as { pace: number }).pace).toBeCloseTo(39.29, 1);
  expect(windowView({ usedPct: 5, resetsAt: S + 60, minutes: 300 }, NOW)).not.toHaveProperty('pace');
  expect(windowView(undefined, NOW)).toEqual({ kind: 'none' });
});

test('sessionState thresholds', () => {
  expect(sessionState(NOW - 29 * 60e3, NOW)).toBe('active');
  expect(sessionState(NOW - 31 * 60e3, NOW)).toBe('idle');
  expect(sessionState(NOW - 13 * 3600e3, NOW)).toBe('recent');
  expect(sessionState(NOW - 8 * 86400e3, NOW)).toBe('gone');
});

test('staleAge: only readings older than 15 minutes carry their age', () => {
  expect(staleAge(NOW - 14 * 60e3, NOW)).toBeUndefined();
  expect(staleAge(NOW - 2 * 3600e3, NOW)).toBe('2h 0m');
  expect(staleAge(undefined, NOW)).toBeUndefined();
});

test('formatting', () => {
  expect(formatDuration(12 * 60)).toBe('12m');
  expect(formatDuration(6720)).toBe('1h 52m');
  expect(formatDuration(4 * 86400 + 6 * 3600)).toBe('4d 6h');
  expect(formatAge(4_200_000)).toBe('1h 10m');
  expect(formatAge(12_000)).toBe('12s');
  expect(formatAge(180_000)).toBe('3m');
});

test('moveWindows', () => {
  const now = 1_000_000, r = now + 3600;
  const five = (usedPct: number, resetsAt = r) => ({ fiveHour: { usedPct, resetsAt, minutes: 300 } });
  let w = moveWindows(undefined, 'claude', five(41), now);
  expect(w).toEqual({ claude: { fiveHour: { from: 41, to: 41, resetsAt: r } } });
  w = moveWindows(w, 'claude', five(44, r + 2), now);
  expect(w?.claude?.fiveHour).toEqual({ from: 41, to: 44, resetsAt: r });
  expect(moveWindows(w, 'claude', five(99, now - 1), now)).toBe(w); // expired
  expect(moveWindows(w, 'claude', undefined, now)).toBe(w);
  expect(moveWindows(w, 'claude', five(99, r - 3600), now)).toBe(w); // an older window says nothing new
  expect(moveWindows(w, 'claude', five(3, r + 18000), now)?.claude?.fiveHour).toEqual({ from: 0, to: 3, resetsAt: r + 18000 });
});
