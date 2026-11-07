import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { joinRel, parentOf, rootKey } from '@shared/files';
import type { Project, Thread } from '@shared/thread';
import { normEntry, normRel, normRels, resolveInside, rootDir, rootRef } from '../../src/main/services/files/guard';

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ark-guard-'));
  outside = mkdtempSync(join(tmpdir(), 'ark-out-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), 'x');
  mkdirSync(join(root, 'dir with space'));
  writeFileSync(join(root, 'dir with space', 'é.txt'), 'x');
  writeFileSync(join(outside, 'x.txt'), 'secret');
  symlinkSync(outside, join(root, 'out'), 'junction');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const ID = '0b5d6a3e-1f2a-4c3b-9d8e-7f6a5b4c3d2e';
const ID2 = '1c6e7b4f-2a3b-4d4c-8e9f-8a7b6c5d4e3f';

test('normRel normalises separators and a trailing slash', () => {
  expect(normRel('src\\a.ts')).toBe('src/a.ts');
  expect(normRel('src/')).toBe('src');
  expect(normRel('')).toBe('');
});

test('normRel refuses parent segments, drives, absolute paths, NUL, non-strings and long paths', () => {
  for (const bad of ['../x', 'a/../../x', 'a/..', 'C:x', 'C:\\x', '/x', '\\x', 'a\0b', 5, null, 'x'.repeat(1025)]) {
    expect(() => normRel(bad), String(bad)).toThrow('Invalid path');
  }
});

test('resolveInside resolves paths under the root', () => {
  expect(resolveInside(root, 'src/a.ts')).toBe(join(root, 'src', 'a.ts'));
  expect(resolveInside(root, 'dir with space/é.txt')).toBe(join(root, 'dir with space', 'é.txt'));
  expect(resolveInside(root, '')).toBe(root);
});

test('resolveInside accepts a new path under missing folders', () => {
  expect(resolveInside(root, 'new/deeper/file.ts')).toBe(join(root, 'new', 'deeper', 'file.ts'));
});

test('resolveInside refuses a junction that points outside', () => {
  expect(() => resolveInside(root, 'out/x.txt')).toThrow('Path is outside the folder');
  expect(() => resolveInside(root, 'out')).toThrow('Path is outside the folder');
});

test('resolveInside does not care how the root is spelled', () => {
  expect(() => resolveInside(root.toUpperCase(), 'src/a.ts')).not.toThrow();
});

test('rootRef accepts a project or thread with a uuid', () => {
  expect(rootRef({ kind: 'project', id: ID })).toEqual({ kind: 'project', id: ID });
  expect(rootRef({ kind: 'thread', id: ID })).toEqual({ kind: 'thread', id: ID });
});

test('rootRef refuses anything else', () => {
  for (const bad of [null, 'x', { kind: 'other', id: ID }, { kind: 'project', id: 'nope' }, { kind: 'project' }]) {
    expect(() => rootRef(bad)).toThrow('Invalid folder');
  }
});

const store = (projects: Project[], threads: Thread[]) => ({
  projects: () => projects,
  get: (id: string) => threads.find((t) => t.id === id),
});
const thread = (build?: { worktree: string; removed?: true }) =>
  ({ id: ID2, projectId: ID, title: 't', createdAt: 0, phase: 'build', status: 'idle', build }) as unknown as Thread;

test('rootDir returns a project folder', () => {
  expect(rootDir({ kind: 'project', id: ID }, store([{ id: ID, name: 'p', dir: root, git: true }], []))).toBe(root);
});

test('rootDir returns an existing thread worktree', () => {
  expect(rootDir({ kind: 'thread', id: ID2 }, store([], [thread({ worktree: root })]))).toBe(root);
});

test('rootDir refuses a thread without a worktree, or whose worktree is gone', () => {
  expect(() => rootDir({ kind: 'thread', id: ID2 }, store([], [thread()]))).toThrow('Worktree not found');
  expect(() => rootDir({ kind: 'thread', id: ID2 }, store([], [thread({ worktree: join(root, 'gone') })]))).toThrow('Worktree not found');
});

test('rootDir refuses a removed worktree', () => {
  // the folder exists (git can leave one behind), but the worktree was removed through Ark
  expect(() => rootDir({ kind: 'thread', id: ID2 }, store([], [thread({ worktree: root, removed: true })]))).toThrow('Worktree not found');
});

test('rootDir refuses unknown ids', () => {
  expect(() => rootDir({ kind: 'project', id: ID }, store([], []))).toThrow('Unknown project');
  expect(() => rootDir({ kind: 'thread', id: ID }, store([], []))).toThrow('Unknown thread');
});

test('parentOf, joinRel and rootKey', () => {
  expect(parentOf('a/b/c.ts')).toBe('a/b');
  expect(parentOf('c.ts')).toBe('');
  expect(joinRel('', 'x')).toBe('x');
  expect(joinRel('a', 'x')).toBe('a/x');
  expect(rootKey({ kind: 'thread', id: ID })).toBe(`thread:${ID}`);
});

test('normEntry is normRel that refuses the root itself', () => {
  expect(normEntry('src\\a.ts')).toBe('src/a.ts');
  for (const bad of ['', '/', '\\', '../x']) expect(() => normEntry(bad), String(bad)).toThrow('Invalid path');
});

test('normRels takes a list of entries and refuses the rest', () => {
  expect(normRels(['a', 'b\\c'])).toEqual(['a', 'b/c']);
  expect(normRels([])).toEqual([]);
  const bad = ['a', [1], ['..\\x'], [''], ['a\0b'], Array<string>(5001).fill('a')];
  for (const v of bad) expect(() => normRels(v), JSON.stringify(v).slice(0, 40)).toThrow('Invalid path');
});
