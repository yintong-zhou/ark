import { beforeEach, expect, test, vi } from 'vitest';
import type { RootRef, WriteResult } from '@shared/files';

/** A Monaco text model, as far as the tabs store uses one. */
class FakeModel {
  version = 1;
  listeners: (() => void)[] = [];
  constructor(public value: string) {}
  getValue = () => this.value;
  getAlternativeVersionId = () => this.version;
  onDidChangeContent = (cb: () => void) => this.listeners.push(cb);
  getFullModelRange = () => ({});
  pushEditOperations = (_s: unknown, edits: { text: string }[]) => this.set(edits[0].text);
  dispose = () => {};
  /** The user typing, or an edit from the store: a new version either way. */
  set(text: string) {
    this.value = text;
    this.version++;
    this.listeners.forEach((l) => l());
  }
}
const models: FakeModel[] = [];
vi.mock('../../src/renderer/editor/monaco', () => ({
  loadMonaco: async () => ({
    Uri: { from: (x: unknown) => x },
    editor: { createModel: (text: string) => (models.push(new FakeModel(text)), models.at(-1)) },
  }),
}));
vi.mock('../../src/renderer/components/Confirm', () => ({ confirmAction: vi.fn(async () => true) }));

// The disk as main sees it: one file with an mtime that moves on every write.
const disk = { text: 'v1', mtimeMs: 100 };
let changed: (key: string, rels: string[] | null) => void = () => {};
let gate: Promise<void> = Promise.resolve(); // holds a read or write in flight
const files = {
  read: vi.fn(async () => {
    await gate;
    return { kind: 'text' as const, text: disk.text, mtimeMs: disk.mtimeMs, bom: false, readonly: false };
  }),
  stat: vi.fn(async () => ({ mtimeMs: disk.mtimeMs })),
  write: vi.fn(async (_r: RootRef, _rel: string, text: string, base: number | null): Promise<WriteResult> => {
    await gate;
    if (base !== null && base !== disk.mtimeMs) return { conflict: true };
    disk.text = text;
    disk.mtimeMs += 100;
    return { conflict: false, mtimeMs: disk.mtimeMs };
  }),
  watch: vi.fn(async () => {}),
  unwatch: vi.fn(async () => {}),
  onChanged: vi.fn((cb: typeof changed) => {
    changed = cb;
    return () => {};
  }),
};
vi.stubGlobal('window', { ark: { files }, addEventListener: () => {} });

const store = await import('../../src/renderer/editor/tabs-store');
const { confirmAction } = await import('../../src/renderer/components/Confirm');
const root: RootRef = { kind: 'project', id: '0b5d6a3e-1f2a-4c3b-9d8e-7f6a5b4c3d2e' };
const P = 'p';
const KEY = `project:${root.id}\na.ts`;
const tab = () => store.tabsOf(P).docs.find((d) => d.tab.key === KEY);

beforeEach(async () => {
  await store.close(P, KEY);
  disk.text = 'v1';
  disk.mtimeMs = 100;
  gate = Promise.resolve();
  await store.open(P, root, 'a.ts');
  files.read.mockClear();
});

test('two saves in a row never conflict with Ark’s own first save', async () => {
  const m = models.at(-1)!;
  m.set('mine 1');
  let release!: () => void;
  gate = new Promise((r) => (release = r));
  const first = store.save(KEY);
  m.set('mine 2');
  const second = store.save(KEY);
  release();
  await Promise.all([first, second]);
  expect(disk.text).toBe('mine 2');
  expect(tab()?.tab.bar).toBeUndefined();
  expect(tab()?.tab.dirty).toBe(false);
});

test('closing a modified tab keeps changes when confirmation is cancelled', async () => {
  models.at(-1)!.set('unsaved');
  vi.mocked(confirmAction).mockResolvedValueOnce(false);
  await store.close(P, KEY);
  expect(tab()?.tab.dirty).toBe(true);
  await store.close(P, KEY);
  expect(tab()).toBeUndefined();
});

test('an automatic reload never replaces what the user typed while the file was being read', async () => {
  const m = models.at(-1)!;
  disk.text = 'agent';
  disk.mtimeMs = 200;
  let release!: () => void;
  gate = new Promise((r) => (release = r));
  changed(`project:${root.id}`, ['a.ts']);
  await vi.waitFor(() => expect(files.read).toHaveBeenCalledTimes(1)); // the reload's read is in flight
  m.set('typed meanwhile');
  release();
  await vi.waitFor(() => expect(tab()?.tab.bar).toBe('changed'));
  expect(m.getValue()).toBe('typed meanwhile');
  expect(tab()?.tab.dirty).toBe(true);
});

test('openDiff opens one tab per file and side, never a model', () => {
  const before = models.length;
  store.openDiff(P, root, 'a.ts', 'staged');
  store.openDiff(P, root, 'a.ts', 'staged');
  store.openDiff(P, root, 'a.ts', 'changes');
  const diffs = store.tabsOf(P).docs.filter((d) => d.diff);
  expect(diffs.map((d) => d.name)).toEqual(['a.ts (staged)', 'a.ts (changes)']);
  expect(diffs.every((d) => !d.model && !d.tab.dirty)).toBe(true);
  expect(store.tabsOf(P).active).toBe(`${KEY}\nchanges`);
  expect(files.read).not.toHaveBeenCalled();
  expect(models.length).toBe(before);
  store.close(P, `${KEY}\nstaged`);
  store.close(P, `${KEY}\nchanges`);
});

test('a disk change never reloads a diff tab', () => {
  store.close(P, KEY);
  store.openDiff(P, root, 'a.ts', 'changes');
  files.stat.mockClear();
  changed(`project:${root.id}`, ['a.ts']);
  expect(files.stat).not.toHaveBeenCalled();
  store.close(P, `${KEY}\nchanges`);
});
