import type { EngineId } from './agent-file';
import type { ThreadWindows, WindowMove } from './thread';
import type { UsageWindow } from './types';

export const IDLE_MS = 30 * 60e3;
export const RECENT_MS = 12 * 3600e3;
export const KEEP_MS = 7 * 86400e3;

const FIVE_HOUR = 300;
const WEEKLY = 10080;

const clamp = (min: number, max: number, v: number) => Math.min(max, Math.max(min, v));

/** Assign windows to slots by duration: agents may report the weekly window as "primary". */
export function pickWindows(ws: UsageWindow[]): { fiveHour?: UsageWindow; weekly?: UsageWindow } {
  return {
    fiveHour: ws.find((w) => w.minutes === FIVE_HOUR),
    weekly: ws.find((w) => w.minutes === WEEKLY),
  };
}

const SAME_WINDOW_S = 60; // agents report the same reset with a few seconds of jitter (2 s seen on Codex)

/**
 * Keep the most recent window. Readings of the same window (resets within jitter) keep the higher
 * usage, because usage never goes down until the window resets - so an older reading can't win.
 */
export function mergeWindow(cur?: UsageWindow, next?: UsageWindow): UsageWindow | undefined {
  if (!cur) return next;
  if (!next) return cur;
  if (Math.abs(next.resetsAt - cur.resetsAt) < SAME_WINDOW_S) return next.usedPct >= cur.usedPct ? next : cur;
  return next.resetsAt > cur.resetsAt ? next : cur;
}

function moveOne(have: WindowMove | undefined, r: UsageWindow | undefined, nowSec: number): WindowMove | undefined {
  if (!r || r.resetsAt <= nowSec) return have; // a missing or expired reading changes nothing
  if (!have) return { from: r.usedPct, to: r.usedPct, resetsAt: r.resetsAt };
  if (Math.abs(r.resetsAt - have.resetsAt) < SAME_WINDOW_S) return r.usedPct > have.to ? { ...have, to: r.usedPct } : have;
  return r.resetsAt > have.resetsAt ? { from: 0, to: r.usedPct, resetsAt: r.resetsAt } : have; // an older window says nothing new
}

/** Folds a usage reading into the thread's record of how each window moved. Returns `have` itself when nothing changed. */
export function moveWindows(
  have: ThreadWindows | undefined,
  engine: EngineId,
  reading: { fiveHour?: UsageWindow; weekly?: UsageWindow } | undefined,
  nowSec: number,
): ThreadWindows | undefined {
  const cur = have?.[engine];
  const fiveHour = moveOne(cur?.fiveHour, reading?.fiveHour, nowSec);
  const weekly = moveOne(cur?.weekly, reading?.weekly, nowSec);
  if (fiveHour === cur?.fiveHour && weekly === cur?.weekly) return have;
  return { ...have, [engine]: { ...(fiveHour ? { fiveHour } : {}), ...(weekly ? { weekly } : {}) } };
}

export type WindowView =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'live'; pct: number; resetIn: number; pace?: number };

export function windowView(w: UsageWindow | undefined, nowMs: number): WindowView {
  if (!w) return { kind: 'none' };
  const nowSec = nowMs / 1000;
  // A window past its reset is stale: never show the old percentage.
  if (w.resetsAt <= nowSec) return { kind: 'reset' };
  const resetIn = Math.round(w.resetsAt - nowSec);
  if (w.minutes !== WEEKLY) return { kind: 'live', pct: w.usedPct, resetIn };
  // Pace: share of the 7-day window already elapsed, i.e. where usage "should" be today.
  const pace = clamp(0, 100, (1 - resetIn / (w.minutes * 60)) * 100);
  return { kind: 'live', pct: w.usedPct, resetIn, pace };
}

export function sessionState(lastSeen: number, nowMs: number): 'active' | 'idle' | 'recent' | 'gone' {
  const age = nowMs - lastSeen;
  if (age < IDLE_MS) return 'active';
  if (age < RECENT_MS) return 'idle';
  if (age < KEEP_MS) return 'recent';
  return 'gone';
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const STALE_MS = 15 * 60e3;

/** Age of a window reading worth showing next to it (limits are shared with the web apps and drift). */
export function staleAge(updatedAt: number | undefined, nowMs: number): string | undefined {
  if (updatedAt === undefined || nowMs - updatedAt < STALE_MS) return undefined;
  return formatAge(nowMs - updatedAt);
}

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return formatDuration(s);
}
