import { expect, test } from 'vitest';
import { changedDirs, groups, letter, parseStatus, type GitEntry } from '@shared/git';

const e = (rel: string, x: string, y: string, conflict = false): GitEntry => ({ rel, x, y, conflict });

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
