import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  groups,
  parseRefs,
  parseStatus,
  parseWorktrees,
  REFS_FORMAT,
  type GitBranches,
  type GitStatus,
  type GitWorktree,
  type ShowResult,
  type ThreadBranch,
} from '@shared/git';
import { resolveInside } from '../files/guard';
import { gitNow, gitNowBuffer, queued } from './run';
import { samePath } from './rules';

/**
 * The Git view's operations on one folder, which must be a repository's top folder. Each is one place in the folder's
 * queue, so a status never sees a commit half done. Inside, git runs unqueued (gitNow): queueing again there would wait
 * for its own caller.
 */

const MAX_SHOW = 5 * 1024 * 1024;
const SNIFF = 8192;

/** Runs `cmd` on a path list sent on stdin, NUL-separated: names never touch the command line. */
const withSpec = (dir: string, cmd: string[], rels: string[]) =>
  gitNow(dir, [...cmd, '--pathspec-from-file=-', '--pathspec-file-nul'], { input: rels.join('\0') });

/**
 * Porcelain paths are relative to the repo's top folder, ours to `dir`; they agree only at the top (a worktree's .git is
 * a file, so it passes too). Anywhere else a path could name the wrong file, so nothing runs.
 */
const inRepo = <T>(dir: string, fn: () => Promise<T>): Promise<T> =>
  queued(dir, async () => {
    if (!existsSync(join(dir, '.git'))) throw new Error("Open the repository's root folder to use Git");
    return fn();
  });

const ok = (p: Promise<unknown>) => p.then(() => true, () => false);
const isMerging = (dir: string) => ok(gitNow(dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']));
const entries = async (dir: string) =>
  parseStatus(
    // No optional locks: the poll must never take index.lock from under the user's own git.
    await gitNow(dir, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], { env: { GIT_OPTIONAL_LOCKS: '0' } }),
  );

export const status = (dir: string): Promise<GitStatus> =>
  inRepo(dir, async () => {
    const s: GitStatus = { ...(await entries(dir)), merging: await isMerging(dir) };
    if (s.merging) {
      // The branch being merged, for the banner; without a name the banner just says "Merging".
      const name = await gitNow(dir, ['name-rev', '--name-only', '--no-undefined', 'MERGE_HEAD']).then((o) => o.trim(), () => '');
      if (name) s.mergeHead = name;
    }
    return s;
  });

export const show = (dir: string, rel: string, side: 'head' | 'index'): Promise<ShowResult> =>
  inRepo(dir, async () => {
    const obj = `${side === 'head' ? 'HEAD' : ':0'}:${rel}`;
    let size: number;
    try {
      size = Number(await gitNow(dir, ['cat-file', '-s', obj]));
    } catch {
      return { kind: 'missing' };
    }
    if (size > MAX_SHOW) return { kind: 'large', size };
    const bytes = await gitNowBuffer(dir, ['cat-file', 'blob', obj]);
    if (bytes.subarray(0, SNIFF).includes(0)) return { kind: 'binary' };
    return { kind: 'text', text: new TextDecoder().decode(bytes) };
  });

/** Stages additions, changes and deletions; `[]` stages everything. */
export const stage = (dir: string, rels: string[]): Promise<void> =>
  inRepo(dir, async () => {
    await (rels.length ? withSpec(dir, ['add', '-A'], rels) : gitNow(dir, ['add', '-A']));
  });

/**
 * `[]` unstages everything. Works before the first commit, and a staged rename is undone on both paths. Unmerged paths
 * are never touched: restoring them would mark the conflict resolved, to HEAD's side.
 */
export const unstage = (dir: string, rels: string[]): Promise<void> =>
  inRepo(dir, async () => {
    const all = !rels.length;
    let list = ['.'];
    // ponytail: with a conflict open, "all" is the staged group, so a status past the 5000-entry cap leaves the rest staged
    if (!all || (await gitNow(dir, ['ls-files', '-u'])).trim()) {
      const picked = new Set(rels);
      list = groups((await entries(dir)).entries)
        .staged.filter((e) => all || picked.has(e.rel))
        .flatMap((e) => (e.orig ? [e.rel, e.orig] : [e.rel]));
      if (!list.length) return;
    }
    const hasHead = await ok(gitNow(dir, ['rev-parse', '-q', '--verify', 'HEAD']));
    // Without a HEAD, `rm --cached` needs -f when the file changed after staging (AM); with --cached it never touches the worktree.
    await withSpec(dir, hasHead ? ['restore', '--staged'] : ['rm', '--cached', '-r', '-f', '-q', '--ignore-unmatch'], list);
  });

/**
 * Throws away worktree changes: untracked files go to `trash`, tracked ones are restored from the index. Only entries
 * in the Changes group count (`[]` is all of them); anything else in `rels` is ignored.
 */
export const discard = (dir: string, rels: string[], trash: (abs: string) => Promise<void>): Promise<void> =>
  inRepo(dir, async () => {
    const want = new Set(rels);
    const pick = groups((await entries(dir)).entries).changes.filter((e) => !want.size || want.has(e.rel));
    for (const e of pick) if (e.x === '?') await trash(resolveInside(dir, e.rel));
    const tracked = pick.filter((e) => e.x !== '?').map((e) => e.rel);
    if (tracked.length) await withSpec(dir, ['restore', '--worktree'], tracked);
  });

/**
 * Commits the index (`all`: after `add -A`, refused while a conflict is open: it would stage the markers). An empty
 * message is only allowed while merging: Git's own is used.
 */
export const commit = (dir: string, message: string, all: boolean): Promise<void> =>
  inRepo(dir, async () => {
    const text = message.trim();
    if (!text && !(await isMerging(dir))) throw new Error('Write a commit message');
    if (all) {
      if ((await gitNow(dir, ['ls-files', '-u'])).trim()) throw new Error('Resolve the conflicts first'); // unmerged index entries
      await gitNow(dir, ['add', '-A']);
    }
    await (text ? gitNow(dir, ['commit', '-F', '-'], { input: text }) : gitNow(dir, ['commit', '--no-edit']));
  });

export const mergeAbort = (dir: string): Promise<void> =>
  inRepo(dir, async () => {
    await gitNow(dir, ['merge', '--abort']);
  });

const refs = async (dir: string): Promise<GitBranches> =>
  parseRefs(await gitNow(dir, ['for-each-ref', `--format=${REFS_FORMAT}`, 'refs/heads', 'refs/remotes']));

export const branches = (dir: string): Promise<GitBranches> => inRepo(dir, () => refs(dir));

/**
 * Switches to a branch named in the list: a local one, or (`track`) a remote-only one, which gets a local branch that
 * tracks it. Any other name is refused, so the renderer can't put an option or a revision expression in the command.
 */
export const switchBranch = (dir: string, name: string, track: boolean): Promise<void> =>
  inRepo(dir, async () => {
    const b = await refs(dir);
    if (!(track ? b.remote.includes(name) : b.local.some((l) => l.name === name))) throw new Error('Unknown branch');
    // `--`: a listed branch can still start with `-` (made by update-ref, or cloned from such a repo).
    await gitNow(dir, track ? ['switch', '--track', '--', name] : ['switch', '--', name]);
  });

export const createBranch = (dir: string, name: string): Promise<void> =>
  inRepo(dir, async () => {
    // `--branch` prints the name it accepted; `@{-1}` is accepted but prints another branch's name, so it must echo ours.
    const accepted = name.startsWith('-') ? null : await gitNow(dir, ['check-ref-format', '--branch', name]).then((o) => o.trim(), () => null);
    if (accepted !== name) throw new Error('Invalid branch name');
    await gitNow(dir, ['switch', '-c', name]);
  });

/** Git's refusal to delete a branch whose commits are on no other branch comes back as `'unmerged'`, for a confirm. */
export const deleteBranch = (dir: string, name: string, force: boolean): Promise<'deleted' | 'unmerged'> =>
  inRepo(dir, async () => {
    if (!(await refs(dir)).local.some((l) => l.name === name && !l.current)) throw new Error('Unknown branch');
    try {
      await gitNow(dir, ['branch', force ? '-D' : '-d', '--', name]);
      return 'deleted';
    } catch (e) {
      if (/not fully merged/i.test((e as Error).message)) return 'unmerged';
      throw e;
    }
  });

const SYNC = { timeoutMs: 120_000 };

export const fetch = (dir: string): Promise<void> =>
  inRepo(dir, async () => {
    await gitNow(dir, ['fetch', '--prune'], SYNC);
  });

/** Fast-forward only: a pull that would need a merge or a rebase changes nothing and says so. */
export const pull = (dir: string): Promise<void> =>
  inRepo(dir, async () => {
    try {
      await gitNow(dir, ['pull', '--ff-only'], SYNC);
    } catch (e) {
      if (/not possible to fast-forward|diverg/i.test((e as Error).message)) throw new Error('The branches have diverged. Pull from the terminal to merge or rebase.');
      throw e;
    }
  });

/** Plain `push` when the branch has an upstream; the first push of a branch goes to `origin` and sets it. */
export const push = (dir: string): Promise<void> =>
  inRepo(dir, async () => {
    const s = await entries(dir);
    if (!s.branch) throw new Error('Check out a branch in the project first');
    if (s.upstream) {
      await gitNow(dir, ['push'], SYNC);
      return;
    }
    if (!(await gitNow(dir, ['remote'])).split(/\r?\n/).includes('origin')) throw new Error('No remote named origin. Add one from the terminal to push.');
    await gitNow(dir, ['push', '-u', 'origin', 'HEAD'], SYNC); // HEAD, not the name: it may start with `-`
  });

const listWorktrees = async (dir: string): Promise<GitWorktree[]> =>
  parseWorktrees(await gitNow(dir, ['worktree', 'list', '--porcelain', '-z']));

/** The main worktree first, then the linked ones. */
export const worktrees = (dir: string): Promise<GitWorktree[]> => inRepo(dir, () => listWorktrees(dir));

/** Removes a linked worktree, never with `--force`: git refuses one with changes. `path` may be spelled either way (`C:/x`, `C:\x`). */
export const removeWorktree = (dir: string, path: string): Promise<void> =>
  inRepo(dir, async () => {
    const list = await listWorktrees(dir);
    const i = list.findIndex((w) => samePath(w.path, path));
    if (i < 0) throw new Error('Unknown worktree');
    if (i === 0) throw new Error("The main worktree can't be removed");
    await gitNow(dir, ['worktree', 'remove', list[i].path]); // git's own spelling, and an absolute path can't look like an option
  });

/** Forgets worktrees whose folders are gone. */
export const pruneWorktrees = (dir: string): Promise<void> =>
  inRepo(dir, async () => {
    await gitNow(dir, ['worktree', 'prune']);
  });

/** The branch HEAD is on (null when detached). From the full ref: `--short` turns a branch that shares a tag's name into `heads/<name>`. */
const headBranch = (dir: string): Promise<string | null> =>
  gitNow(dir, ['symbolic-ref', '-q', 'HEAD']).then((o) => o.trim().replace(/^refs\/heads\//, '') || null, () => null);

const mustBeLocal = async (dir: string, branch: string) => {
  if (!(await refs(dir)).local.some((l) => l.name === branch)) throw new Error('Unknown branch');
};

/** Where a thread's branch would merge to (the branch the project is on) and how many commits it is ahead of it. */
export const threadBranch = (dir: string, branch: string): Promise<ThreadBranch> =>
  inRepo(dir, async () => {
    await mustBeLocal(dir, branch);
    const into = await headBranch(dir);
    // Full refs: a tag with the same name must not stand in for a branch, and a name can't be read as an option.
    const ahead = into ? Number((await gitNow(dir, ['rev-list', '--count', `refs/heads/${into}..refs/heads/${branch}`])).trim()) : 0;
    return { branch, into, ahead };
  });

/**
 * Merges a local branch into the one HEAD is on, always with a merge commit. A conflict leaves the merge in progress
 * for the Git view to resolve; any other failure (local changes in the way, say) changes nothing and is rethrown.
 */
export const mergeBranch = (dir: string, branch: string): Promise<'merged' | 'conflict'> =>
  inRepo(dir, async () => {
    await mustBeLocal(dir, branch);
    const into = await headBranch(dir);
    if (!into) throw new Error('Check out a branch in the project first');
    try {
      // The full ref, so a tag with the same name is never merged instead; given that way git would title the commit
      // "Merge branch 'refs/heads/x'", so the title is ours.
      await gitNow(dir, ['merge', '--no-ff', '--no-edit', '-m', `Merge branch '${branch}' into ${into}`, `refs/heads/${branch}`]);
      return 'merged';
    } catch (e) {
      if (await isMerging(dir)) return 'conflict';
      throw e;
    }
  });
