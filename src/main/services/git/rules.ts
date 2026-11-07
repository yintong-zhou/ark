import { resolve } from 'node:path';
import type { RootRef } from '@shared/files';
import { GIT_BUSY } from '@shared/git';
import type { Thread } from '@shared/thread';
import { rootDir, type RootStore } from '../files/guard';

/** What the Git view may do with a thread's folder and branch. Pure apart from `rootDir`, so the tests pass a fake store. */

/** Git prints `C:/x`, Node `C:\x`, and Windows ignores case. */
export const samePath = (a: string, b: string): boolean => resolve(a).toLowerCase() === resolve(b).toLowerCase();

/**
 * The folder a root names. A thread's worktree belongs to the developer while its turn runs, so the write actions (not
 * status or show) wait for it; the Git view shows a note and disables them.
 */
export function gitRoot(ref: RootRef, store: RootStore, write: boolean): string {
  const dir = rootDir(ref, store);
  if (write && ref.kind === 'thread' && store.get(ref.id)?.status === 'running') throw new Error(GIT_BUSY);
  return dir;
}

/** The thread that owns the worktree at `path`; a removed worktree has no owner any more. */
export const worktreeThread = (threads: Thread[], path: string): Thread | undefined =>
  threads.find((t) => t.build && !t.build.removed && samePath(t.build.worktree, path));

/** A worktree no thread owns can go; a thread's goes once the thread is done and quiet. */
export function checkRemovable(t: Thread | undefined): void {
  if (t && !(t.phase === 'done' && t.status !== 'running')) throw new Error('Finish the thread before removing its worktree');
}

/** The branch to merge for a thread, which must not be mid-turn. */
export function checkMergeable(t: Thread): string {
  if (t.status === 'running') throw new Error(GIT_BUSY);
  if (!t.build) throw new Error('Unknown worktree');
  return t.build.branch;
}
