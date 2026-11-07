import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { commit, discard, mergeAbort, show, stage, status, unstage } from '../../src/main/services/git/repo';
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
