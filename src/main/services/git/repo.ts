import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { groups, parseStatus, type GitStatus, type ShowResult } from '@shared/git';
import { resolveInside } from '../files/guard';
import { gitNow, gitNowBuffer, queued } from './run';

/**
 * The Git view's operations on one folder, which must be a repository's top folder. Each is one place in the folder's
 * queue, so a status never sees a commit half done. Inside, git runs unqueued (gitNow): a gitRun there would wait for
 * its own caller.
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
      const name = await gitNow(dir, ['name-rev', '--name-only', 'MERGE_HEAD']).then((o) => o.trim(), () => '');
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

/** `[]` unstages everything. Works before the first commit, and a staged rename is undone on both paths. */
export const unstage = (dir: string, rels: string[]): Promise<void> =>
  inRepo(dir, async () => {
    const all = !rels.length;
    const list = all ? ['.'] : [...rels];
    if (!all) {
      const picked = new Set(rels);
      for (const e of (await entries(dir)).entries) if (e.orig && picked.has(e.rel)) list.push(e.orig);
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
