import { useEffect, useSyncExternalStore } from 'react';
import { rootKey, type RootRef } from '@shared/files';
import type { GitStatus } from '@shared/git';
import { readable } from '../errors';

/**
 * Each root's git status, kept at module level so the Git view and the file tree read the same copy. A root is
 * refreshed while some component shows it: on watcher changes (debounced), on window focus, after each action
 * (the action returns the fresh status) and on a slow poll. `status` stays when a refresh fails; `error` says why.
 */
export type GitState = { status?: GitStatus; error?: string; busy: boolean };

const IDLE: GitState = { busy: false }; // one constant for roots never shown, so React sees no change
const DEBOUNCE_MS = 300;
const POLL_MS = 5000;

type Entry = { root: RootRef; state: GitState; shown: number; debounce?: ReturnType<typeof setTimeout> };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function entry(root: RootRef): Entry {
  const key = rootKey(root);
  let e = entries.get(key);
  if (!e) entries.set(key, (e = { root, state: IDLE, shown: 0 }));
  return e;
}

function patch(root: RootRef, change: Partial<GitState>) {
  const e = entry(root);
  e.state = { ...e.state, ...change };
  emit();
}

/** The current state of `root`, for tests and readers outside React. */
export const gitState = (root: RootRef): GitState => entries.get(rootKey(root))?.state ?? IDLE;

/** Reloads the status. Overlapping refreshes: the last to resolve wins (main already runs git one at a time per folder). */
export async function refresh(root: RootRef): Promise<void> {
  try {
    patch(root, { status: await window.ark.git.status(root), error: undefined });
  } catch (e) {
    patch(root, { error: readable(e) });
  }
}

/** Runs a write action, which returns the fresh status. A failure is rethrown for the caller to show. */
export async function act(root: RootRef, call: () => Promise<GitStatus>): Promise<void> {
  patch(root, { busy: true });
  try {
    patch(root, { status: await call(), error: undefined, busy: false });
  } catch (e) {
    patch(root, { busy: false });
    throw e;
  }
}

const shownEntries = () => [...entries.values()].filter((e) => e.shown > 0);

let started = false;
let poll: ReturnType<typeof setInterval> | undefined;

/** The watcher and focus listeners, made on first use. */
function start() {
  if (started) return;
  started = true;
  window.ark.files.onChanged((key) => {
    const e = entries.get(key);
    if (!e || e.shown === 0) return;
    clearTimeout(e.debounce);
    e.debounce = setTimeout(() => void refresh(e.root), DEBOUNCE_MS);
  });
  window.addEventListener('focus', () => shownEntries().forEach((e) => void refresh(e.root)));
}

/** Counts `root` as shown by one more component; the first one watches it and loads its status. */
export function show(root: RootRef) {
  start();
  const e = entry(root);
  if (e.shown++ > 0) return;
  void window.ark.files.watch(root).catch(() => {}); // a missing worktree shows as the status error
  void refresh(root);
  // ponytail: polls because the watcher doesn't see commits, checkouts or index changes made in a terminal; upgrade: also watch the git dir and drop the poll.
  poll ??= setInterval(() => {
    if (document.hasFocus()) shownEntries().forEach((x) => void refresh(x.root));
  }, POLL_MS);
}

/** One component fewer shows `root`; the last one unwatches it, and the poll stops once no root is shown. */
export function hide(root: RootRef) {
  const e = entries.get(rootKey(root));
  if (!e || e.shown === 0 || --e.shown > 0) return;
  clearTimeout(e.debounce);
  void window.ark.files.unwatch(root).catch(() => {});
  if (shownEntries().length === 0) {
    clearInterval(poll);
    poll = undefined;
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** The git state of `root`. While mounted and `enabled` the root counts as shown; disabled never touches git. */
export function useGit(root: RootRef, enabled: boolean): GitState {
  const key = rootKey(root);
  useEffect(() => {
    if (!enabled) return;
    show(root);
    return () => hide(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key names the root
  }, [key, enabled]);
  return useSyncExternalStore(subscribe, () => (enabled ? gitState(root) : IDLE));
}
