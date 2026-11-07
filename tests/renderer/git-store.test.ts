import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { rootKey, type RootRef } from '@shared/files';
import type { GitStatus } from '@shared/git';

const clean = (branch = 'main'): GitStatus => ({ branch, oid: 'abc', ahead: 0, behind: 0, merging: false, entries: [], truncated: false });

const git = { status: vi.fn<(r: RootRef) => Promise<GitStatus>>(async () => clean()) };
let changed: (key: string, rels: string[] | null) => void = () => {};
let focus: () => void = () => {};
const files = {
  watch: vi.fn<(r: RootRef) => Promise<void>>(async () => {}),
  unwatch: vi.fn<(r: RootRef) => Promise<void>>(async () => {}),
  onChanged: vi.fn((cb: typeof changed) => ((changed = cb), () => {})),
};
let focused = true;
vi.stubGlobal('window', {
  ark: { git, files },
  addEventListener: (type: string, cb: () => void) => {
    if (type === 'focus') focus = cb;
  },
});
vi.stubGlobal('document', { hasFocus: () => focused });

const store = await import('../../src/renderer/git/status-store');
let n = 0;
let root: RootRef;

beforeEach(() => {
  root = { kind: 'project', id: `p${++n}` }; // a fresh root per test: the store is module-level
  focused = true;
  vi.useFakeTimers();
  vi.clearAllMocks();
  git.status.mockImplementation(async () => clean());
});
afterEach(() => {
  store.hide(root); // stops this test's poll; a hide with nothing shown is a no-op
  vi.useRealTimers();
});

const calls = (r: RootRef) => git.status.mock.calls.filter((c) => rootKey(c[0]) === rootKey(r)).length;

test('showing a root watches it and loads its status once; hiding unwatches', async () => {
  store.show(root);
  await vi.advanceTimersByTimeAsync(0);
  expect(files.watch).toHaveBeenCalledWith(root);
  expect(calls(root)).toBe(1);
  expect(store.gitState(root)).toEqual({ status: clean(), error: undefined, busy: false });
  store.hide(root);
  expect(files.unwatch).toHaveBeenCalledWith(root);
});

test('a change event refreshes once after 300 ms', async () => {
  store.show(root);
  await vi.advanceTimersByTimeAsync(0);
  git.status.mockClear();
  changed(rootKey(root), ['a.ts']);
  await vi.advanceTimersByTimeAsync(50);
  changed(rootKey(root), ['b.ts']);
  await vi.advanceTimersByTimeAsync(50);
  changed(rootKey(root), null);
  changed('project:someone-else', null); // another root: not ours
  await vi.advanceTimersByTimeAsync(299);
  expect(calls(root)).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls(root)).toBe(1);
});

test('polls every 5 s only while shown and focused', async () => {
  store.show(root);
  await vi.advanceTimersByTimeAsync(0);
  git.status.mockClear();
  await vi.advanceTimersByTimeAsync(5000);
  expect(calls(root)).toBe(1);
  focused = false;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(calls(root)).toBe(1);
  focused = true;
  store.hide(root);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(calls(root)).toBe(1);
});

test('the window regaining focus refreshes every shown root', async () => {
  store.show(root);
  await vi.advanceTimersByTimeAsync(0);
  git.status.mockClear();
  focus();
  await vi.advanceTimersByTimeAsync(0);
  expect(calls(root)).toBe(1);
});

test('a root shown twice stays watched until the second hide', async () => {
  store.show(root);
  store.show(root);
  expect(files.watch).toHaveBeenCalledTimes(1);
  store.hide(root);
  expect(files.unwatch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000);
  expect(calls(root)).toBeGreaterThan(1); // still polling
  store.hide(root);
  expect(files.unwatch).toHaveBeenCalledTimes(1);
});

test('a failed refresh stores the error and keeps the last status', async () => {
  store.show(root);
  await vi.advanceTimersByTimeAsync(0);
  git.status.mockRejectedValueOnce(new Error("Error invoking remote method 'git:status': Error: not a repository"));
  await store.refresh(root);
  expect(store.gitState(root)).toEqual({ status: clean(), error: 'not a repository', busy: false });
  await store.refresh(root);
  expect(store.gitState(root).error).toBeUndefined();
});

test('act stores the returned status and clears busy on failure', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const done = store.act(root, async () => (await gate, clean('feature')));
  expect(store.gitState(root).busy).toBe(true);
  release();
  await done;
  expect(store.gitState(root)).toEqual({ status: clean('feature'), error: undefined, busy: false });

  await expect(store.act(root, async () => Promise.reject(new Error('The team is working in this worktree.')))).rejects.toThrow('The team is working');
  expect(store.gitState(root).busy).toBe(false);
  expect(store.gitState(root).status?.branch).toBe('feature');
});

test('a disabled root never calls git', async () => {
  // useGit(root, false) never calls show, so nothing is watched, loaded or polled
  expect(store.gitState(root)).toEqual({ busy: false });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(git.status).not.toHaveBeenCalled();
  expect(files.watch).not.toHaveBeenCalled();
});
