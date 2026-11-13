import { expect, test } from 'vitest';
import { threadGitActions, threadGitLines, type ThreadGit } from '@shared/git';

const state = (o: Partial<ThreadGit> = {}): ThreadGit => ({
  branch: 'ark/t', source: 's', uncommitted: [], changes: 0, into: 'main', target: 't', ahead: 0,
  projectChanges: 0, merging: false, remote: 'origin', upstream: false, unpushed: 0, behind: 0, stamp: 'x', ...o,
});

test('nothing left: no action, and the summary says so', () => {
  expect(threadGitActions(state(), 'done')).toEqual([]);
  expect(threadGitLines(state())).toEqual(['Branch ark/t.', 'No uncommitted files in the worktree.', 'Nothing to merge into main.', 'Nothing to push.']);
});

test('each action names its source and target, and only relevant ones are offered', () => {
  const s = state({ changes: 2, uncommitted: ['a', 'b'], ahead: 3, unpushed: 3 });
  expect(threadGitActions(s, 'done')).toEqual([
    { kind: 'commit', label: 'Commit 2 files on ark/t' },
    { kind: 'merge', label: 'Merge ark/t into main', blocked: 'Commit or discard the worktree changes first.' },
    { kind: 'push', label: 'Push ark/t to origin' },
  ]);
  expect(threadGitLines(s)).toEqual([
    'Branch ark/t.', 'Uncommitted files in the worktree: 2.', 'Commits not yet in main: 3.', 'Commits not pushed: 3 (never pushed; a push would go to origin).',
  ]);
});

test('blocked actions say why: a new cycle, no target, a merge in progress, a dirty target, a diverged remote', () => {
  const ready = state({ ahead: 1, unpushed: 1 });
  for (const a of threadGitActions(ready, 'planning')) expect(a.blocked).toBe('A new build cycle is in progress on this branch.');
  expect(threadGitActions(state({ ahead: 1, into: null, target: null }), 'done')[0]).toEqual({ kind: 'merge', label: 'Merge ark/t', blocked: 'The project has no branch checked out: check out the target branch first.' });
  expect(threadGitActions(state({ ahead: 1, merging: true }), 'done')[0].blocked).toBe('Finish or abort the merge in progress in the project first.');
  expect(threadGitActions(state({ ahead: 1, projectChanges: 1 }), 'done')[0].blocked).toBe('main has uncommitted changes in the project: commit or discard them first.');
  const diverged = state({ upstream: true, remote: 'origin/ark/t', unpushed: 1, behind: 2 });
  expect(threadGitActions(diverged, 'done')).toEqual([{ kind: 'push', label: 'Push ark/t to origin/ark/t', blocked: 'origin/ark/t has 2 commits this branch lacks: pull or merge them first. Ark never force-pushes.' }]);
  expect(threadGitLines(diverged)).toContain('origin/ark/t has 2 commits this branch lacks.');
});

test('no remote: push is never offered, and the summary says why', () => {
  const s = state({ remote: null, unpushed: 0, ahead: 1 });
  expect(threadGitActions(s, 'done').map((a) => a.kind)).toEqual(['merge']);
  expect(threadGitLines(s)).toContain('No remote: push is not available.');
});
