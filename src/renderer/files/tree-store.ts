import { useEffect, useSyncExternalStore } from 'react';
import { dirsToRefresh } from '@shared/editor-tabs';
import { rootKey, type DirListing, type RootRef } from '@shared/files';
import { readable } from '../errors';

/**
 * The explorer's state per root, kept at module level so it survives leaving the Threads area (spec §5.5):
 * which folders are expanded and what each one holds. Changes from the watcher refresh the expanded folders.
 */
export type Tree = { root: RootRef; listings: ReadonlyMap<string, DirListing>; expanded: ReadonlySet<string>; error?: string };

const trees = new Map<string, Tree>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function get(root: RootRef): Tree {
  const key = rootKey(root);
  let t = trees.get(key);
  if (!t) {
    t = { root, listings: new Map(), expanded: new Set(['']) };
    trees.set(key, t);
    void load(key, '');
  }
  return t;
}

function set(key: string, change: (t: Tree) => Tree) {
  const t = trees.get(key);
  if (!t) return;
  trees.set(key, change(t));
  emit();
}

async function load(key: string, rel: string) {
  const t = trees.get(key);
  if (!t) return;
  try {
    const l = await window.ark.files.list(t.root, rel);
    set(key, (x) => ({ ...x, listings: new Map(x.listings).set(rel, l), error: undefined }));
  } catch (e) {
    // A folder that went away collapses; the root itself failing is shown.
    set(key, (x) => {
      const listings = new Map(x.listings);
      listings.delete(rel);
      const expanded = new Set(x.expanded);
      if (rel) expanded.delete(rel);
      return { ...x, listings, expanded, error: rel ? x.error : readable(e) };
    });
  }
}

export function toggle(root: RootRef, rel: string) {
  const key = rootKey(root);
  const open = get(root).expanded.has(rel);
  set(key, (x) => {
    const expanded = new Set(x.expanded);
    if (open) expanded.delete(rel);
    else expanded.add(rel);
    return { ...x, expanded };
  });
  if (!open) void load(key, rel);
}

/** Opens a folder (after creating something in it) without collapsing it when it already is open. */
export function expand(root: RootRef, rel: string) {
  if (!get(root).expanded.has(rel)) toggle(root, rel);
}

let subscribed = false;
function subscribe(l: () => void) {
  listeners.add(l);
  if (!subscribed) {
    subscribed = true;
    window.ark.files.onChanged((key, rels) => {
      const t = trees.get(key);
      if (t) for (const d of dirsToRefresh([...t.expanded], rels)) void load(key, d);
    });
  }
  return () => listeners.delete(l);
}

/** The tree of `root`, watched while a component shows it. */
export function useTree(root: RootRef): Tree {
  const key = rootKey(root);
  useEffect(() => {
    void window.ark.files.watch(root).catch(() => {}); // a missing worktree shows as the tree's error
    return () => void window.ark.files.unwatch(root).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key names the root
  }, [key]);
  return useSyncExternalStore(subscribe, () => get(root));
}
