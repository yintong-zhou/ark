import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { ThreadGit } from '@shared/git';
import { ThreadGitPanel } from '../../src/renderer/components/ThreadGit';

const state = (o: Partial<ThreadGit> = {}): ThreadGit => ({
  branch: 'ark/t', source: 's', uncommitted: ['a.ts'], changes: 1, into: 'main', target: 't', ahead: 2,
  projectChanges: 0, merging: false, remote: 'origin', upstream: false, unpushed: 2, behind: 0, stamp: 'x', ...o,
});
const html = (s: ThreadGit, phase: 'done' | 'planning' = 'done') =>
  renderToStaticMarkup(createElement(ThreadGitPanel, { state: s, phase, busy: false, message: 'Finish T', onMessage: () => {}, onAction: () => {} }));

test('the card lists the state and an explicit button per action, with source and target', () => {
  const h = html(state());
  expect(h).toContain('aria-label="Git actions for this thread"');
  expect(h).toContain('Uncommitted files in the worktree: 1.');
  expect(h).toContain('>Commit 1 file on ark/t</button>');
  expect(h).toContain('aria-label="Commit message"');
  expect(h).toContain('>Merge ark/t into main</button>');
  expect(h).toContain('>Push ark/t to origin</button>');
  // merge waits for the commit, and says why next to its button
  expect(h).toMatch(/disabled="">Merge ark\/t into main<\/button>/);
  expect(h).toContain('Commit or discard the worktree changes first.');
});

test('a new cycle disables every action; nothing left shows no button', () => {
  expect(html(state(), 'planning').match(/disabled=""/g)).toHaveLength(3);
  const done = html(state({ uncommitted: [], changes: 0, ahead: 0, unpushed: 0 }));
  expect(done).not.toContain('<button');
  expect(done).toContain('Nothing to commit, merge or push.');
});

test('a requested action card shows only its concrete action', () => {
  const h = renderToStaticMarkup(createElement(ThreadGitPanel, { state: state(), phase: 'done', busy: false, message: 'Finish T', onMessage: () => {}, onAction: () => {}, requested: 'merge' }));
  expect(h).toContain('Merge ark/t into main');
  expect(h).not.toContain('>Push ark/t');
  expect(h).not.toContain('>Commit 1 file');
});
