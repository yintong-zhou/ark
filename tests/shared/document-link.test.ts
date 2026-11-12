import { describe, expect, it } from 'vitest';
import { documentLink, findDocumentLink, threadDocumentRoots } from '../../src/shared/document-link';

describe('document links', () => {
  const roots = [{ dir: 'D:/DEVS/ark', root: { kind: 'project' as const, id: 'p' } }, { dir: 'D:/work/tree', root: { kind: 'thread' as const, id: 't' } }];
  it('resolves relative and encoded document paths in the selected root', () => {
    expect(documentLink('./docs/My%20Plan.md#section', roots, roots[0].root)).toEqual({ root: roots[0].root, rel: 'docs/My Plan.md' });
    expect(documentLink('README.md', roots, roots[1].root)).toEqual({ root: roots[1].root, rel: 'README.md' });
  });
  it('maps absolute and file URLs to their matching root', () => {
    expect(documentLink('D:\\work\\tree\\README.md', roots, roots[0].root)).toEqual({ root: roots[1].root, rel: 'README.md' });
    expect(documentLink('file:///D:/DEVS/ark/docs/Plan.md', roots, roots[1].root)).toEqual({ root: roots[0].root, rel: 'docs/Plan.md' });
  });
  it('refuses external schemes, traversal, invalid escapes and paths outside the roots', () => {
    for (const href of ['https://example.com/a.md', '//server/share/a', '../secret', '%2e%2e/secret', 'D:/DEVS/ark-other/a', 'file://server/share/a', '#heading', 'bad%xx']) {
      expect(documentLink(href, roots, roots[0].root)).toBeNull();
    }
  });
});

it('ignores line and column suffixes for relative, absolute and file URLs', () => {
  const roots = [{ dir: 'D:/repo', root: { kind: 'project' as const, id: 'p' } }];
  for (const href of ['src/app.ts:12', 'src/app.ts:12:3#part', 'D:/repo/src/app.ts:12:3', 'file:///D:/repo/src/app.ts:12']) {
    expect(documentLink(href, roots, roots[0].root)).toEqual({ root: roots[0].root, rel: 'src/app.ts' });
  }
  for (const href of ['src/app.ts:0', 'src/app.ts:12:0', '../secret:5', 'https://example.com/a:12']) {
    expect(documentLink(href, roots, roots[0].root)).toBeNull();
  }
});

it('prefers the worktree for relative links and falls back only when absent', async () => {
  const project = { dir: 'D:/repo', root: { kind: 'project' as const, id: 'p' } };
  const worktree = { dir: 'D:/worktree', root: { kind: 'thread' as const, id: 't' } };
  expect(await findDocumentLink('README.md', [worktree, project], async () => true)).toEqual({ root: worktree.root, rel: 'README.md' });
  expect(await findDocumentLink('README.md', [worktree, project], async (root) => root.kind === 'project')).toEqual({ root: project.root, rel: 'README.md' });
  expect(await findDocumentLink('D:/repo/README.md', [worktree, project], async () => false)).toEqual({ root: project.root, rel: 'README.md' });
  expect(await findDocumentLink('README.md', [worktree, project], async () => false)).toEqual({ root: project.root, rel: 'README.md' });
  await expect(findDocumentLink('../secret', [worktree, project], async () => true)).rejects.toThrow('Cannot open this link');
  await expect(findDocumentLink('README.md', [worktree, project], async () => { throw new Error('Path is outside the folder'); })).rejects.toThrow('Path is outside the folder');
});


it('orders thread folders independently of the selected sidebar root', () => {
  const project = { dir: 'D:/repo', root: { kind: 'project' as const, id: 'p' } };
  const worktree = { dir: 'D:/worktree', root: { kind: 'thread' as const, id: 't' } };
  expect(threadDocumentRoots(project, worktree)).toEqual([worktree, project]);
  expect(threadDocumentRoots(project)).toEqual([project]);
});

