import { expect, test } from 'vitest';
import { changedDirs, commitState, groups, letter, parseRefs, parseStatus, parseWorktrees, type GitEntry, type GitStatus } from '@shared/git';

const e = (rel: string, x: string, y: string, conflict = false): GitEntry => ({ rel, x, y, conflict });

const commitStatus = (entries: GitEntry[], merging = false): GitStatus => ({ branch: 'main', oid: 'abc', ahead: 0, behind: 0, merging, entries, truncated: false });

test('the Git primary action stages pending changes before committing, preserving commit-all from the menu', () => {
  const unstaged = commitStatus([e('a.ts', '.', 'M')]);
  expect(commitState(unstaged, '', false)).toEqual({ all: true, stageFirst: true, canStage: true, canCommit: false });
  expect(commitState(unstaged, 'Update a', false).canCommit).toBe(true);
  const staged = commitStatus([e('a.ts', 'M', '.')]);
  expect(commitState(staged, 'Update a', false)).toEqual({ all: false, stageFirst: false, canStage: false, canCommit: true });
  expect(commitState(staged, '   ', false).canCommit).toBe(false);
  expect(commitState(commitStatus([]), 'Nothing', false).canCommit).toBe(false);
});

test('conflicts and busy worktrees keep commit disabled, while ordinary changes can still be staged separately', () => {
  const conflicted = commitStatus([e('conflict.ts', 'U', 'U', true), e('a.ts', '.', 'M')], true);
  expect(commitState(conflicted, 'Resolve', false)).toEqual({ all: false, stageFirst: false, canStage: true, canCommit: false });
  expect(commitState(commitStatus([e('a.ts', '.', 'M')]), 'Update', true)).toEqual({ all: true, stageFirst: true, canStage: false, canCommit: false });
});

test('a resolved merge can commit its index with Git\'s message, without staging unrelated worktree changes', () => {
  expect(commitState(commitStatus([e('a.ts', '.', 'M')], true), '', false)).toEqual({ all: false, stageFirst: false, canStage: true, canCommit: true });
});

test('parseStatus reads branch, upstream and ahead/behind', () => {
  const out = '# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0';
  expect(parseStatus(out)).toEqual({ branch: 'main', oid: 'abc123', upstream: 'origin/main', ahead: 2, behind: 1, entries: [], truncated: false });
});

test('parseStatus reads detached and initial', () => {
  const s = parseStatus('# branch.oid (initial)\0# branch.head (detached)\0');
  expect(s).toEqual({ branch: null, oid: null, ahead: 0, behind: 0, entries: [], truncated: false });
  expect('upstream' in s).toBe(false);
});

test('parseStatus reads ordinary, rename, unmerged and untracked entries, names with spaces', () => {
  const out = [
    '1 .M N... 100644 100644 100644 a1 a1 src/a b.ts',
    '2 R. N... 100644 100644 100644 a1 a1 R100 new name.ts\0old name.ts',
    'u UU N... 100644 100644 100644 100644 h1 h2 h3 c.ts',
    '? dir/ü.txt',
  ].join('\0') + '\0';
  expect(parseStatus(out).entries).toEqual([
    { rel: 'src/a b.ts', x: '.', y: 'M', conflict: false },
    { rel: 'new name.ts', x: 'R', y: '.', orig: 'old name.ts', conflict: false },
    { rel: 'c.ts', x: 'U', y: 'U', conflict: true },
    { rel: 'dir/ü.txt', x: '?', y: '?', conflict: false },
  ]);
});

test('parseStatus caps entries', () => {
  const s = parseStatus('? a\0? b\0? c\0', 2);
  expect(s.entries).toHaveLength(2);
  expect(s.truncated).toBe(true);
});

test('groups puts a file in staged and changes, conflicts alone', () => {
  const mm = e('a.ts', 'M', 'M');
  const uu = e('b.ts', 'U', 'U', true);
  const un = e('c.ts', '?', '?');
  const g = groups([mm, uu, un]);
  expect(g.staged).toEqual([mm]);
  expect(g.changes).toEqual([mm, un]);
  expect(g.conflicts).toEqual([uu]);
});

test('letter maps chars per side', () => {
  const md = e('a', 'M', 'D');
  expect(letter(md, 'staged')).toBe('M');
  expect(letter(md, 'changes')).toBe('D');
  expect(letter(md, 'tree')).toBe('D');
  expect(letter(e('a', 'A', '.'), 'tree')).toBe('A');
  expect(letter(e('a', 'T', '.'), 'staged')).toBe('M');
  expect(letter(e('a', 'C', '.'), 'staged')).toBe('A');
  const un = e('a', '?', '?');
  expect(letter(un, 'changes')).toBe('U');
  expect(letter(un, 'tree')).toBe('U');
  expect(letter(e('a', 'U', 'U', true), 'tree')).toBe('!');
});

test('changedDirs lists every ancestor folder', () => {
  expect(changedDirs([e('a/b/c.ts', 'M', '.'), e('d.ts', '.', 'M')])).toEqual(new Set(['a', 'a/b']));
});

test('parseRefs: current first, track counts, remote HEAD and twins left out', () => {
  const line = (...f: string[]) => f.join('\0');
  const out = [
    line('refs/heads/a', 'a', '', '', ' '),
    line('refs/heads/main', 'main', 'origin/main', 'ahead 2, behind 1', '*', 'C:/my project'),
    line('refs/heads/busy', 'busy', '', '', ' ', 'C:/worktrees/client app'),
    line('refs/heads/old', 'old', 'origin/old', 'gone', ' '),
    line('refs/heads/v1', 'heads/v1', '', '', ' '), // a tag named v1 makes :short say heads/v1
    line('refs/remotes/origin/HEAD', 'origin', '', '', ' '),
    line('refs/remotes/origin/main', 'origin/main', '', '', ' '),
    line('refs/remotes/origin/a', 'origin/a', '', '', ' '),
    line('refs/remotes/origin/feat/x', 'origin/feat/x', '', '', ' '),
  ].join('\r\n') + '\r\n';
  expect(parseRefs(out)).toEqual({
    local: [
      { name: 'main', current: true, upstream: 'origin/main', ahead: 2, behind: 1, worktree: 'C:/my project' },
      { name: 'a', current: false, ahead: 0, behind: 0 },
      { name: 'busy', current: false, ahead: 0, behind: 0, worktree: 'C:/worktrees/client app' },
      { name: 'old', current: false, upstream: 'origin/old', ahead: 0, behind: 0 },
      { name: 'v1', current: false, ahead: 0, behind: 0 },
    ],
    remote: ['origin/feat/x'],
  });
});

test('parseWorktrees: main first, branch short name, detached and prunable', () => {
  const out = 'worktree C:/r\0HEAD abc\0branch refs/heads/main\0\0worktree C:/w\0HEAD def\0detached\0prunable gitdir file points to non-existent location\0\0';
  expect(parseWorktrees(out)).toEqual([
    { path: 'C:/r', head: 'abc', branch: 'main', detached: false, locked: false, prunable: false },
    { path: 'C:/w', head: 'def', detached: true, locked: false, prunable: true },
  ]);
});
