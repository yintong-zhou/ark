import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { expect, test } from 'vitest';
import { GIT_BUSY } from '@shared/git';
import type { Project, Thread } from '@shared/thread';
import { checkMergeable, checkRemovable, gitRoot, samePath, worktreeThread } from '../../src/main/services/git/rules';

const ID = '0b5d6a3e-1f2a-4c3b-9d8e-7f6a5b4c3d2e';
const ID2 = '1c6e7b4f-2a3b-4d4c-8e9f-8a7b6c5d4e3f';

const thread = (o: Partial<Thread> & { build?: Partial<NonNullable<Thread['build']>> } = {}) =>
  ({ id: ID2, projectId: ID, title: 't', createdAt: 0, phase: 'build', status: 'idle', ...o }) as unknown as Thread;
const withBuild = (o: Partial<Thread> = {}, b: object = {}) =>
  thread({ build: { worktree: process.cwd(), branch: 'ark/t-1', plan: '', phases: [], current: 0, ...b }, ...o } as never);

test('gitRoot refuses writes on a running thread but allows reads', () => {
  const store = (t: Thread) => ({ projects: () => [] as Project[], get: (id: string) => (id === t.id ? t : undefined) });
  const ref = { kind: 'thread' as const, id: ID2 };
  const running = store(withBuild({ status: 'running' }));
  expect(() => gitRoot(ref, running, true)).toThrow(GIT_BUSY);
  expect(gitRoot(ref, running, false)).toBe(process.cwd());
  expect(gitRoot(ref, store(withBuild()), true)).toBe(process.cwd());
  const project = { projects: () => [{ id: ID, name: 'p', dir: process.cwd(), git: true }], get: () => undefined };
  expect(gitRoot({ kind: 'project', id: ID }, project, true)).toBe(process.cwd());
});

test('worktreeThread matches across slash and case, and skips removed worktrees', () => {
  expect(samePath('C:/Work/Tree', 'c:\\work\\tree')).toBe(true);
  expect(samePath('C:/Work/Tree', 'C:/Work/Other')).toBe(false);
  const t = withBuild({}, { worktree: 'C:\\Work\\Tree' });
  expect(worktreeThread([thread(), t], 'c:/work/tree')).toBe(t);
  expect(worktreeThread([t], 'c:/work/other')).toBeUndefined();
  expect(worktreeThread([withBuild({}, { worktree: 'C:\\Work\\Tree', removed: true })], 'c:/work/tree')).toBeUndefined();
});

test('checkRemovable allows only done, idle threads', () => {
  expect(() => checkRemovable(undefined)).not.toThrow(); // a worktree no thread owns
  expect(() => checkRemovable(withBuild({ phase: 'done', status: 'idle' }))).not.toThrow();
  const msg = 'Finish the thread before removing its worktree';
  expect(() => checkRemovable(withBuild({ phase: 'build', status: 'idle' }))).toThrow(msg);
  expect(() => checkRemovable(withBuild({ phase: 'done', status: 'running' }))).toThrow(msg);
  expect(() => checkRemovable(withBuild({ phase: 'planning', status: 'waiting' }))).toThrow(msg);
});

test('checkMergeable refuses a running thread', () => {
  expect(checkMergeable(withBuild())).toBe('ark/t-1');
  expect(() => checkMergeable(withBuild({ status: 'running' }))).toThrow(GIT_BUSY);
  expect(() => checkMergeable(thread())).toThrow('Unknown worktree');
});

test('samePath sees through a junction, and compares a missing path by its spelling', () => {
  const base = mkdtempSync(join(tmpdir(), 'ark-rules-'));
  try {
    const target = join(base, 'real');
    mkdirSync(join(target, 'sub'), { recursive: true });
    const link = join(base, 'jn');
    symlinkSync(target, link, 'junction');
    // git prints the real path of a worktree added through a junction; the thread keeps the spelling it was given
    expect(samePath(join(link, 'sub'), join(target, 'sub'))).toBe(true);
    expect(samePath(join(link, 'sub'), join(target, 'SUB').split(sep).join('/'))).toBe(true);
    const owner = withBuild({}, { worktree: join(link, 'sub') });
    expect(worktreeThread([owner], join(target, 'sub'))).toBe(owner);
    expect(samePath(join(base, 'real', 'x'), join(base, 'REAL', 'X'))).toBe(true); // missing: resolved only
    expect(samePath(join(link, 'x'), join(target, 'x'))).toBe(false); // missing: no junction to follow
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
