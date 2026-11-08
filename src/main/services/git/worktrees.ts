import { rootKey } from '@shared/files';
import type { GitWorktree, WorktreeRow } from '@shared/git';
import type { Thread } from '@shared/thread';
import type { RootWatcher } from '../files/watch';
import * as git from './repo';
import { queued } from './run';
import { checkRemovable, removable, samePath, worktreeThread } from './rules';

/** The worktree list's actions, with the threads that own worktrees kept in step: a gone worktree is never offered again. */

export const IN_USE = 'Worktree removed, but its folder is in use. Close what holds it to delete it.';

export type WorktreeDeps = {
  /** Every thread of every project: two projects can share one repository. */
  threads: () => Thread[];
  watcher: Pick<RootWatcher, 'drop' | 'watch'>;
  /** The conductor's `worktreeRemoved`: saves `build.removed` and tells the renderer. */
  removed: (threadId: string) => void;
};

const listed = (list: GitWorktree[], path: string) => list.some((w) => samePath(w.path, path));

const rows = (list: GitWorktree[], threads: Thread[]): WorktreeRow[] =>
  list.map((w) => {
    const t = worktreeThread(threads, w.path);
    return t ? { ...w, thread: { id: t.id, title: t.title, done: removable(t) } } : w;
  });

export const worktreeRows = async (dir: string, d: WorktreeDeps): Promise<WorktreeRow[]> => rows(await git.worktrees(dir), d.threads());

/** Marks removed the thread of every path in `gone` that `after` no longer lists, and closes its watch. */
function reconcile(gone: string[], after: GitWorktree[], d: WorktreeDeps): void {
  for (const p of gone) {
    if (listed(after, p)) continue;
    const t = worktreeThread(d.threads(), p);
    if (!t) continue;
    d.watcher.drop(rootKey({ kind: 'thread', id: t.id }));
    d.removed(t.id);
  }
}

/**
 * Removes a linked worktree of `dir`'s repository. Git can fail half way (a process holding the folder as its cwd):
 * the files and git's entry are gone, the folder stays. The list read after the attempt decides, not git's exit code.
 */
export async function removeWorktree(dir: string, path: string, d: WorktreeDeps): Promise<WorktreeRow[]> {
  const t = worktreeThread(d.threads(), path);
  checkRemovable(t);
  const wt = t?.build?.worktree ?? path; // the folder's queue key, spelled as its status and show spell it
  const op = async () => {
    const before = await git.worktrees(dir);
    // The recursive watch holds the folder on Windows, and the tree, status and tabs stores each hold a reference to
    // it: close it whatever the count, and put the references back if the worktree stays.
    const key = t && rootKey({ kind: 'thread', id: t.id });
    const held = key ? d.watcher.drop(key) : 0;
    const failed = await git.removeWorktree(dir, path).then(() => undefined, (e: unknown) => e);
    const after = await git.worktrees(dir);
    reconcile([...before.map((w) => w.path), path], after, d);
    if (listed(after, path)) {
      for (let i = 0; i < held; i++) {
        try {
          d.watcher.watch(key as string, wt);
        } catch {
          // the folder is gone: nothing to watch
        }
      }
    }
    if (failed) throw listed(before, path) && !listed(after, path) ? new Error(IN_USE) : failed;
    return rows(after, d.threads());
  };
  // The worktree's queue, then the project's (inside the git calls), so a status or show on the worktree never runs
  // during the removal. Nothing takes them the other way round. Not when they are one folder: it would wait for itself.
  return samePath(wt, dir) ? op() : queued(wt, op);
}

/** Forgets worktrees whose folders are gone, and marks their threads removed. */
export async function pruneWorktrees(dir: string, d: WorktreeDeps): Promise<WorktreeRow[]> {
  const before = await git.worktrees(dir);
  await git.pruneWorktrees(dir);
  const after = await git.worktrees(dir);
  reconcile(before.map((w) => w.path), after, d);
  return rows(after, d.threads());
}
