import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { markIgnored } from '../../src/main/services/files/ignored';
import { listDir } from '../../src/main/services/files/ops';
import { gitNow } from '../../src/main/services/git/run';

let root: string;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ark-ignored-'));
  await gitNow(root, ['init']);
});
afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
const put = (rel: string, text = '') => writeFileSync(join(root, rel), text);
const entries = async (rel = '') => (await markIgnored(root, rel, listDir(root, rel))).entries;
const ignored = async (rel = '') => (await entries(rel)).filter((e) => e.ignored).map((e) => e.name);

test('Git determines folders, negations, excludes and literal unusual names in one directory', async () => {
  put('.gitignore', 'cache/\n*.tmp\n!keep.tmp\n');
  mkdirSync(join(root, 'cache'));
  for (const name of ['a b.tmp', '-ignored.tmp', 'città.tmp', 'keep.tmp', 'normal.ts']) put(name);
  put('.git/info/exclude', 'private.txt\n');
  put('private.txt');
  expect(new Set(await ignored())).toEqual(new Set(['cache', 'a b.tmp', '-ignored.tmp', 'città.tmp', 'private.txt']));
});

test('tracked files are never marked ignored and nested rules are honored', async () => {
  put('tracked.tmp');
  await gitNow(root, ['add', '--', 'tracked.tmp']);
  put('.gitignore', '*.tmp\n');
  mkdirSync(join(root, 'sub'));
  put('sub/.gitignore', '!keep.tmp\n');
  put('sub/keep.tmp');
  put('sub/drop.tmp');
  expect(await ignored()).not.toContain('tracked.tmp');
  expect(await ignored('sub')).toEqual(['drop.tmp']);
});

test('configured excludes are read fresh and non-Git roots keep browsing normally', async () => {
  put('global-ignore', 'hidden.txt\n');
  put('hidden.txt');
  await gitNow(root, ['config', 'core.excludesFile', join(root, 'global-ignore')]);
  expect(await ignored()).toContain('hidden.txt');
  put('global-ignore', '');
  expect(await ignored()).not.toContain('hidden.txt');
  const plain = mkdtempSync(join(tmpdir(), 'ark-no-git-'));
  try {
    put('normal.ts');
    writeFileSync(join(plain, 'file.txt'), '');
    const listing = listDir(plain, '');
    expect(await markIgnored(plain, '', listing)).toEqual(listing);
  } finally { rmSync(plain, { recursive: true, force: true }); }
});

test('works in a linked worktree with a .git file', async () => {
  put('.gitignore', '*.tmp\n');
  await gitNow(root, ['add', '--', '.gitignore']);
  await gitNow(root, ['-c', 'user.name=Ark Test', '-c', 'user.email=ark@test.invalid', 'commit', '-m', 'fixture']);
  const worktree = join(root, 'linked');
  await gitNow(root, ['worktree', 'add', '-b', 'fixture', worktree]);
  writeFileSync(join(worktree, 'ignored.tmp'), '');
  const listing = await markIgnored(worktree, '', listDir(worktree, ''));
  expect(listing.entries.find((e) => e.name === 'ignored.tmp')?.ignored).toBe(true);
});
