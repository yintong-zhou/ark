import { parentOf, rootKey, type RootRef, type WriteResult } from './files';

/**
 * An open file. `mtimeMs` is the disk version the buffer is based on (null once the file is gone); `bar` is a
 * notice over the editor; `force` means the user chose to keep their edits, so the next save overwrites.
 */
export type FileTab = {
  key: string;
  root: RootRef;
  rel: string;
  dirty: boolean;
  mtimeMs: number | null;
  bom: boolean;
  readonly: boolean;
  bar?: 'changed' | 'deleted';
  force: boolean;
};

export const tabKey = (root: RootRef, rel: string): string => `${rootKey(root)}\n${rel}`;

/**
 * What a disk change means for an open tab. The tab's own mtime coming back is the echo of its own save: nothing.
 * A clean buffer reloads; a dirty one is never touched, it gets the changed bar.
 */
export function diskChanged(tab: FileTab, disk: { mtimeMs: number } | null): { tab: FileTab; reload: boolean } {
  if (!disk) return { tab: tab.bar === 'deleted' ? tab : { ...tab, bar: 'deleted', mtimeMs: null }, reload: false };
  if (disk.mtimeMs === tab.mtimeMs) return { tab, reload: false };
  if (!tab.dirty) return { tab: { ...tab, bar: undefined }, reload: true };
  // A Keep mine chosen against an older version does not cover this newer one.
  return { tab: { ...tab, bar: 'changed', force: false }, reload: false };
}

export const keepMine = (tab: FileTab): FileTab => ({ ...tab, bar: undefined, force: true });

/**
 * The mtime a save must still find on disk, or null to write regardless. A buffer with no disk version (the file
 * was deleted, then came back) gets -1, which no file matches: the save conflicts until the user picks a side.
 */
export const saveBase = (tab: FileTab): number | null => (tab.force || tab.bar === 'deleted' ? null : (tab.mtimeMs ?? -1));

export function afterSave(tab: FileTab, r: WriteResult): FileTab {
  if (r.conflict) return { ...tab, bar: 'changed' };
  return { ...tab, dirty: false, force: false, bar: undefined, mtimeMs: r.mtimeMs };
}

/** Whether a batch of changed rels can affect `rel`: the file itself, or a folder above it (deleted or renamed). */
export const touches = (rels: string[] | null, rel: string): boolean =>
  rels === null || rels.some((r) => r === rel || rel.startsWith(r + '/'));

/** The expanded folders whose listing a batch of changes can alter. */
export function dirsToRefresh(expanded: string[], rels: string[] | null): string[] {
  if (rels === null) return expanded;
  const open = new Set(expanded);
  const hit = new Set<string>();
  for (const r of rels) for (const d of [parentOf(r), r]) if (open.has(d)) hit.add(d);
  return [...hit];
}
