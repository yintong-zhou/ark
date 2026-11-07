import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { commit, discard, mergeAbort, show, stage, status, unstage } from '../../src/main/services/git/repo';
import { gitNow, queued } from '../../src/main/services/git/run';
import { groups } from '../../src/shared/git';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Plain git for test setup: unlike the code under test it runs hooks and reads the global config. */
const sh = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const put = (dir: string, rel: string, data: string | Uint8Array) => writeFileSync(join(dir, rel), data);

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ark-git-'));
  dirs.push(dir);
  sh(dir, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.name', 'Test'], ['user.email', 't@example.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) sh(dir, 'config', k, v);
  return dir;
}

/** A repo with one commit holding the given files. */
function committed(files: Record<string, string>): string {
  const dir = repo();
  for (const [rel, text] of Object.entries(files)) put(dir, rel, text);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const rows = async (dir: string) => (await status(dir)).entries.map((e) => `${e.x}${e.y} ${e.rel}`);

test('status lists modified, staged, untracked and the branch', async () => {
  const dir = committed({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  put(dir, 'a.txt', 'a2\n');
  put(dir, 'b.txt', 'b2\n');
  sh(dir, 'add', 'b.txt');
  put(dir, 'c.txt', 'c\n');
  const s = await status(dir);
  expect(s).toMatchObject({ branch: 'main', merging: false, truncated: false, ahead: 0, behind: 0 });
  expect(s.oid).toMatch(/^[0-9a-f]{40,64}$/);
  expect(s.entries).toEqual([
    { rel: 'a.txt', x: '.', y: 'M', conflict: false },
    { rel: 'b.txt', x: 'M', y: '.', conflict: false },
    { rel: 'c.txt', x: '?', y: '?', conflict: false },
  ]);
});

test('stage and unstage single files and all', async () => {
  const dir = committed({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  put(dir, 'a.txt', 'a2\n');
  put(dir, 'b.txt', 'b2\n');
  put(dir, 'c.txt', 'c\n');
  await stage(dir, ['a.txt']);
  expect(await rows(dir)).toEqual(['M. a.txt', '.M b.txt', '?? c.txt']);
  await unstage(dir, ['a.txt']);
  expect(await rows(dir)).toEqual(['.M a.txt', '.M b.txt', '?? c.txt']);
  await stage(dir, []);
  expect(await rows(dir)).toEqual(['M. a.txt', 'M. b.txt', 'A. c.txt']);
  await unstage(dir, []);
  expect(await rows(dir)).toEqual(['.M a.txt', '.M b.txt', '?? c.txt']);
  // staging a deletion works too
  rmSync(join(dir, 'a.txt'));
  await stage(dir, ['a.txt']);
  expect(await rows(dir)).toContain('D. a.txt');
});

test('unstage works before the first commit', async () => {
  const dir = repo();
  put(dir, 'a.txt', 'a\n');
  put(dir, 'b.txt', 'b\n');
  await stage(dir, ['a.txt']);
  expect(await rows(dir)).toEqual(['A. a.txt', '?? b.txt']);
  await unstage(dir, ['a.txt']);
  expect(await rows(dir)).toEqual(['?? a.txt', '?? b.txt']);
  await stage(dir, []);
  await unstage(dir, []);
  expect(await rows(dir)).toEqual(['?? a.txt', '?? b.txt']);
});

test('unstaging a rename unstages both paths', async () => {
  const dir = committed({ 'a.txt': 'some content that git can match as a rename\n' });
  sh(dir, 'mv', 'a.txt', 'b.txt');
  expect((await status(dir)).entries).toMatchObject([{ rel: 'b.txt', x: 'R', orig: 'a.txt' }]);
  await unstage(dir, ['b.txt']);
  const entries = (await status(dir)).entries;
  expect(entries.filter((e) => e.x !== '.' && e.x !== '?')).toEqual([]);
  expect(await rows(dir)).toEqual(['.D a.txt', '?? b.txt']);
});

test('discard restores a tracked file and trashes an untracked one', async () => {
  const dir = committed({ 'a.txt': 'one\n', 's.txt': 's\n' });
  put(dir, 'a.txt', 'two\n');
  put(dir, 's.txt', 's2\n');
  sh(dir, 'add', 's.txt'); // staged only: not in the Changes group, so discard must leave it alone
  put(dir, 'u.txt', 'new\n');
  const trash = vi.fn(async (abs: string) => rmSync(abs));
  await discard(dir, ['s.txt', 'a.txt', 'u.txt', 'nope.txt'], trash);
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('one\n');
  expect(trash).toHaveBeenCalledTimes(1);
  expect(trash).toHaveBeenCalledWith(join(dir, 'u.txt'));
  expect(await rows(dir)).toEqual(['M. s.txt']);
});

test('discard with no list takes every entry in Changes', async () => {
  const dir = committed({ 'a.txt': 'one\n', 'b.txt': 'one\n' });
  put(dir, 'a.txt', 'two\n');
  rmSync(join(dir, 'b.txt'));
  put(dir, 'u.txt', 'new\n');
  const trash = vi.fn(async (abs: string) => rmSync(abs));
  await discard(dir, [], trash);
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('one\n');
  expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('one\n');
  expect(trash).toHaveBeenCalledWith(join(dir, 'u.txt'));
  expect(await rows(dir)).toEqual([]);
});

test('odd names stage, unstage and discard as plain names', async () => {
  // ':(top)x.txt' cannot exist on Windows; '[ab].txt' is glob magic that would also match a.txt
  const odd = ['-rf.txt', 'a b ü.txt', '[ab].txt', ...(process.platform === 'win32' ? [] : [':(top)x.txt'])];
  const dir = committed({ 'a.txt': 'a\n' });
  put(dir, 'a.txt', 'a2\n'); // a decoy a glob would catch
  for (const n of odd) put(dir, n, 'x\n');
  await stage(dir, odd);
  expect(await rows(dir)).toEqual(expect.arrayContaining(odd.map((n) => `A. ${n}`)));
  expect(await rows(dir)).toContain('.M a.txt');
  await unstage(dir, odd);
  expect(await rows(dir)).toEqual(expect.arrayContaining(odd.map((n) => `?? ${n}`)));
  const trash = vi.fn(async (abs: string) => rmSync(abs));
  await discard(dir, odd, trash);
  expect(trash.mock.calls.map((c) => c[0]).sort()).toEqual(odd.map((n) => join(dir, n)).sort());
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('a2\n'); // the decoy is untouched

  // tracked odd names are discarded by restore, not trashed
  for (const n of odd) put(dir, n, 'x\n');
  sh(dir, 'add', '--', ...odd);
  sh(dir, 'commit', '-q', '-m', 'odd');
  for (const n of odd) put(dir, n, 'changed\n');
  trash.mockClear();
  await discard(dir, odd, trash);
  expect(trash).not.toHaveBeenCalled();
  for (const n of odd) expect(readFileSync(join(dir, n), 'utf8')).toBe('x\n');
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('a2\n');
});

test('commit commits staged only; all stages everything first', async () => {
  const dir = committed({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  put(dir, 'a.txt', 'a2\n');
  put(dir, 'b.txt', 'b2\n');
  await stage(dir, ['a.txt']);
  await commit(dir, 'only a\n\nwith a body', false);
  expect(sh(dir, 'log', '-1', '--format=%B').trim()).toBe('only a\n\nwith a body');
  expect(sh(dir, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('a.txt');
  expect(await rows(dir)).toEqual(['.M b.txt']);
  put(dir, 'c.txt', 'c\n');
  await commit(dir, 'everything', true);
  expect(sh(dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(['b.txt', 'c.txt']);
  expect(await rows(dir)).toEqual([]);
});

test('commit refuses an empty message', async () => {
  const dir = committed({ 'a.txt': 'a\n' });
  put(dir, 'a.txt', 'a2\n');
  await stage(dir, []);
  await expect(commit(dir, ' \n\t', false)).rejects.toThrow('Write a commit message');
  await expect(commit(dir, '', true)).rejects.toThrow('Write a commit message');
  expect(await rows(dir)).toEqual(['M. a.txt']);
  expect(sh(dir, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
});

test('a pre-commit hook never runs', async () => {
  const dir = committed({ 'a.txt': 'a\n' });
  put(dir, '.git/hooks/pre-commit', '#!/bin/sh\necho ran > hook-ran\n');
  // control: plain git does run this hook here, so the assertion below can fail
  sh(dir, 'commit', '-q', '--allow-empty', '-m', 'control');
  expect(existsSync(join(dir, 'hook-ran'))).toBe(true);
  rmSync(join(dir, 'hook-ran'));
  put(dir, 'a.txt', 'a2\n');
  await stage(dir, ['a.txt']);
  await commit(dir, 'no hooks', false);
  expect(existsSync(join(dir, 'hook-ran'))).toBe(false);
  expect(sh(dir, 'log', '-1', '--format=%s').trim()).toBe('no hooks');
});

test('show reads HEAD and index, reports missing, binary and large', async () => {
  const dir = repo();
  put(dir, 'new.txt', 'x\n');
  expect(await show(dir, 'new.txt', 'head')).toEqual({ kind: 'missing' }); // no commit yet
  expect(await show(dir, 'nope.txt', 'index')).toEqual({ kind: 'missing' });
  put(dir, 'a.txt', 'héllo\n');
  put(dir, 'bin.dat', Buffer.from([1, 2, 0, 3]));
  put(dir, 'big.txt', Buffer.alloc(5 * 1024 * 1024 + 1, 'a'));
  put(dir, 'edge.txt', Buffer.alloc(5 * 1024 * 1024, 'a'));
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  put(dir, 'a.txt', 'staged\n');
  sh(dir, 'add', 'a.txt');
  put(dir, 'a.txt', 'worktree\n');
  expect(await show(dir, 'a.txt', 'head')).toEqual({ kind: 'text', text: 'héllo\n' });
  expect(await show(dir, 'a.txt', 'index')).toEqual({ kind: 'text', text: 'staged\n' });
  expect(await show(dir, 'bin.dat', 'head')).toEqual({ kind: 'binary' });
  expect(await show(dir, 'big.txt', 'head')).toEqual({ kind: 'large', size: 5 * 1024 * 1024 + 1 });
  expect((await show(dir, 'edge.txt', 'index')).kind).toBe('text'); // exactly 5 MB is still shown
  expect(await show(dir, 'nope.txt', 'head')).toEqual({ kind: 'missing' });
  sh(dir, 'rm', '-q', '-f', '--cached', 'a.txt');
  expect(await show(dir, 'a.txt', 'index')).toEqual({ kind: 'missing' });
  expect(await show(dir, 'a.txt', 'head')).toEqual({ kind: 'text', text: 'héllo\n' });
});

test('a merge conflict shows as conflict and merging; empty message commits with Git\'s message after staging; mergeAbort clears it', async () => {
  const dir = committed({ 'a.txt': 'base\n' });
  sh(dir, 'checkout', '-q', '-b', 'other');
  put(dir, 'a.txt', 'other\n');
  sh(dir, 'commit', '-q', '-am', 'other change');
  sh(dir, 'checkout', '-q', 'main');
  put(dir, 'a.txt', 'main\n');
  sh(dir, 'commit', '-q', '-am', 'main change');

  expect(() => sh(dir, 'merge', 'other')).toThrow();
  const s = await status(dir);
  expect(s.merging).toBe(true);
  expect(s.mergeHead).toBe('other');
  expect(s.entries).toMatchObject([{ rel: 'a.txt', conflict: true }]);
  expect(groups(s.entries).conflicts).toHaveLength(1);
  await expect(commit(dir, '', false)).rejects.toThrow(); // still unresolved: Git refuses

  put(dir, 'a.txt', 'fixed\n');
  await stage(dir, ['a.txt']);
  await commit(dir, '  ', false); // empty message while merging: --no-edit
  expect(sh(dir, 'log', '-1', '--format=%s').trim()).toBe("Merge branch 'other'");
  expect((await status(dir)).merging).toBe(false);

  sh(dir, 'reset', '-q', '--hard', 'HEAD^');
  expect(() => sh(dir, 'merge', 'other')).toThrow();
  expect((await status(dir)).merging).toBe(true);
  await mergeAbort(dir);
  const after = await status(dir);
  expect(after.merging).toBe(false);
  expect(after.entries).toEqual([]);
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('main\n');
});

test('a status started during a commit waits for it', async () => {
  const dir = committed({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
  put(dir, 'a.txt', 'a2\n');
  await stage(dir, ['a.txt']);
  const [, s] = await Promise.all([commit(dir, 'wait for me', false), status(dir)]);
  expect(s.entries).toEqual([]);

  // also when the commit has more steps before it commits (add -A first)
  put(dir, 'b.txt', 'b2\n');
  const [, s2] = await Promise.all([commit(dir, 'again', true), status(dir)]);
  expect(s2.entries).toEqual([]);
});

test('a failed call does not block the next one on the same folder', async () => {
  const dir = committed({ 'a.txt': 'a\n' });
  const bad = commit(dir, '', false);
  const good = status(dir);
  await expect(bad).rejects.toThrow('Write a commit message');
  expect((await good).branch).toBe('main');
});

test('unstage works before the first commit when the file was edited after staging', async () => {
  const dir = repo();
  put(dir, 'a.txt', 'a\n');
  await stage(dir, ['a.txt']);
  put(dir, 'a.txt', 'edited after staging\n'); // AM: git rm --cached refuses this without -f
  expect(await rows(dir)).toEqual(['AM a.txt']);
  await unstage(dir, ['a.txt']);
  expect(await rows(dir)).toEqual(['?? a.txt']);
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('edited after staging\n'); // the worktree is never touched
  await stage(dir, []);
  put(dir, 'a.txt', 'edited again\n');
  await unstage(dir, []);
  expect(await rows(dir)).toEqual(['?? a.txt']);
});

test('every operation refuses a folder that is not the repository root', async () => {
  const dir = committed({ 'a.txt': 'a\n' });
  mkdirSync(join(dir, 'app'));
  put(dir, 'app/x.txt', 'x\n');
  const app = join(dir, 'app');
  const msg = "Open the repository's root folder to use Git";
  const trash = vi.fn(async () => {});
  await expect(status(app)).rejects.toThrow(msg);
  await expect(show(app, 'x.txt', 'head')).rejects.toThrow(msg);
  await expect(stage(app, ['x.txt'])).rejects.toThrow(msg);
  await expect(unstage(app, [])).rejects.toThrow(msg);
  await expect(discard(app, [], trash)).rejects.toThrow(msg);
  await expect(commit(app, 'm', true)).rejects.toThrow(msg);
  await expect(mergeAbort(app)).rejects.toThrow(msg);
  expect(trash).not.toHaveBeenCalled();
  expect(await rows(dir)).toEqual(['?? app/x.txt']); // nothing happened
  expect(sh(dir, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
});

test('a worktree, whose .git is a file, counts as a root', async () => {
  const dir = committed({ 'a.txt': 'a\n' });
  const wt = mkdtempSync(join(tmpdir(), 'ark-git-wt-'));
  dirs.push(wt);
  sh(dir, 'worktree', 'add', '-q', '-b', 'side', wt);
  expect(readFileSync(join(wt, '.git'), 'utf8').startsWith('gitdir:')).toBe(true);
  put(wt, 'a.txt', 'a2\n');
  expect((await status(wt)).branch).toBe('side');
  await stage(wt, []);
  await commit(wt, 'in the worktree', false);
  expect(sh(wt, 'log', '-1', '--format=%s').trim()).toBe('in the worktree');
});

test('status takes no optional lock: it never rewrites the index', async () => {
  const dir = committed({ 'a.txt': 'a\n' });
  const index = () => readFileSync(join(dir, '.git', 'index'));
  const t = new Date(Date.now() + 60_000);
  utimesSync(join(dir, 'a.txt'), t, t); // same content, new stat data: a plain git status refreshes the index
  const before = index();
  expect((await status(dir)).entries).toEqual([]);
  expect(index().equals(before)).toBe(true);
  sh(dir, 'status'); // control: plain git does rewrite it here, so the assertion above can fail
  expect(index().equals(before)).toBe(false);
});

test('commit with nothing staged says so', async () => {
  const dir = committed({ 'a.txt': 'a\n' });
  await expect(commit(dir, 'm', false)).rejects.toThrow(/nothing/);
});

test('commit all refuses while conflicts are unresolved', async () => {
  const dir = committed({ 'a.txt': 'base\n' });
  sh(dir, 'checkout', '-q', '-b', 'other');
  put(dir, 'a.txt', 'other\n');
  sh(dir, 'commit', '-q', '-am', 'other change');
  sh(dir, 'checkout', '-q', 'main');
  put(dir, 'a.txt', 'main\n');
  sh(dir, 'commit', '-q', '-am', 'main change');
  expect(() => sh(dir, 'merge', 'other')).toThrow();
  const head = sh(dir, 'rev-parse', 'HEAD');
  await expect(commit(dir, 'with markers', true)).rejects.toThrow('Resolve the conflicts first');
  await expect(commit(dir, '', true)).rejects.toThrow('Resolve the conflicts first');
  expect(sh(dir, 'rev-parse', 'HEAD')).toBe(head);
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toContain('<<<<<<<'); // add -A did not run
  expect(await rows(dir)).toEqual(['UU a.txt']);
});

/** A merge of `other` into main with a conflict in a.txt; `other` also adds n.txt, which the merge stages by itself. */
function conflicted(): string {
  const dir = committed({ 'a.txt': 'base\n' });
  sh(dir, 'checkout', '-q', '-b', 'other');
  put(dir, 'a.txt', 'other\n');
  put(dir, 'n.txt', 'new\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'other change');
  sh(dir, 'checkout', '-q', 'main');
  put(dir, 'a.txt', 'main\n');
  sh(dir, 'commit', '-q', '-am', 'main change');
  expect(() => sh(dir, 'merge', 'other')).toThrow();
  return dir;
}

test('unstage never touches a conflicted path, not even for "all"', async () => {
  const dir = conflicted();
  const sorted = async (d: string) => (await status(d)).entries.map((e) => `${e.x}${e.y} ${e.rel}`).sort(); // git lists unmerged paths last
  expect(await sorted(dir)).toEqual(['A. n.txt', 'UU a.txt']);
  await unstage(dir, ['a.txt']); // asked by name
  expect(await sorted(dir)).toEqual(['A. n.txt', 'UU a.txt']);
  await unstage(dir, []);
  expect(await sorted(dir)).toEqual(['?? n.txt', 'UU a.txt']); // the conflict is still open
  expect(sh(dir, 'ls-files', '-u')).toContain('a.txt');
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toContain('<<<<<<<');
  await unstage(dir, []); // nothing staged any more: a no-op, not an error
  expect(await sorted(dir)).toEqual(['?? n.txt', 'UU a.txt']);
});

test('the merge banner has no name when no branch reaches the merged commit', async () => {
  const dir = committed({ 'a.txt': 'base\n' });
  sh(dir, 'checkout', '-q', '-b', 'other');
  put(dir, 'a.txt', 'other\n');
  sh(dir, 'commit', '-q', '-am', 'other change');
  const sha = sh(dir, 'rev-parse', 'HEAD').trim();
  sh(dir, 'checkout', '-q', 'main');
  put(dir, 'a.txt', 'main\n');
  sh(dir, 'commit', '-q', '-am', 'main change');
  sh(dir, 'branch', '-q', '-D', 'other'); // the commit stays, but no ref names it
  expect(() => sh(dir, 'merge', sha)).toThrow();
  const s = await status(dir);
  expect(s.merging).toBe(true);
  expect(s.mergeHead).toBeUndefined(); // not the string "undefined"
});

test('a failure that only talks on stdout gets a capped message', async () => {
  const dir = committed({ 'a.txt': 'a\n' });
  put(dir, 'a.txt', 'x'.repeat(20_000) + '\n');
  // `diff --exit-code` prints the whole diff on stdout and exits 1
  const err = await gitNow(dir, ['diff', '--exit-code']).catch((e: Error) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message.length).toBe(2000);
});

test('the queue key ignores case and how the path is spelled', async () => {
  const base = mkdtempSync(join(tmpdir(), 'ark-q-'));
  dirs.push(base);
  const order: string[] = [];
  const slow = queued(join(base, 'Repo'), async () => {
    await new Promise((r) => setTimeout(r, 60));
    order.push('first');
  });
  const other = queued(join(base, 'repo') + sep + '.' + sep, async () => void order.push('second'));
  await Promise.all([slow, other]);
  expect(order).toEqual(['first', 'second']);
});
