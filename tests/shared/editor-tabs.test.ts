import { expect, test } from 'vitest';
import { afterSave, diskChanged, dirsToRefresh, keepMine, saveBase, tabKey, touches, type FileTab } from '@shared/editor-tabs';
import type { RootRef } from '@shared/files';

const root: RootRef = { kind: 'project', id: '0b5d6a3e-1f2a-4c3b-9d8e-7f6a5b4c3d2e' };
const base: FileTab = { key: tabKey(root, 'a.ts'), root, rel: 'a.ts', dirty: false, mtimeMs: 100, bom: false, readonly: false, force: false };

test('tabKey joins the root key and the rel', () => {
  expect(tabKey(root, 'src/a.ts')).toBe(`project:${root.id}\nsrc/a.ts`);
});

test("the editor's own save echoing back changes nothing", () => {
  expect(diskChanged(base, { mtimeMs: 100 })).toEqual({ tab: base, reload: false });
  const dirty = { ...base, dirty: true };
  expect(diskChanged(dirty, { mtimeMs: 100 })).toEqual({ tab: dirty, reload: false });
});

test('a clean tab reloads when the disk changes', () => {
  const r = diskChanged(base, { mtimeMs: 200 });
  expect(r.reload).toBe(true);
  expect(r.tab.bar).toBeUndefined();
});

test('a dirty tab gets the changed bar instead of reloading', () => {
  const r = diskChanged({ ...base, dirty: true }, { mtimeMs: 200 });
  expect(r.reload).toBe(false);
  expect(r.tab).toMatchObject({ bar: 'changed', dirty: true, mtimeMs: 100 });
});

test('a deleted file gets the deleted bar, clean or dirty', () => {
  for (const dirty of [false, true]) {
    const r = diskChanged({ ...base, dirty }, null);
    expect(r).toEqual({ tab: { ...base, dirty, bar: 'deleted', mtimeMs: null }, reload: false });
  }
});

test('a deleted file that is deleted again stays as it is', () => {
  const gone = diskChanged(base, null).tab;
  expect(diskChanged(gone, null)).toEqual({ tab: gone, reload: false });
});

test('saveBase guards with the mtime, unless the user chose to keep theirs or the file was deleted', () => {
  expect(saveBase(base)).toBe(100);
  expect(saveBase(keepMine({ ...base, bar: 'changed' }))).toBeNull();
  expect(saveBase(diskChanged(base, null).tab)).toBeNull();
});

test('a deleted file that comes back while the buffer is dirty never saves over it unasked', () => {
  const gone = diskChanged({ ...base, dirty: true }, null).tab;
  const back = diskChanged(gone, { mtimeMs: 500 }).tab;
  expect(back.bar).toBe('changed');
  expect(saveBase(back)).not.toBeNull();
  expect(saveBase(keepMine(back))).toBeNull();
});

test('keepMine clears the bar and forces the next save', () => {
  expect(keepMine({ ...base, bar: 'changed', dirty: true })).toEqual({ ...base, dirty: true, force: true });
});

test('a conflicting save shows the changed bar and keeps the edits', () => {
  expect(afterSave({ ...base, dirty: true }, { conflict: true })).toEqual({ ...base, dirty: true, bar: 'changed' });
});

test('a successful save clears dirty, force and the bar', () => {
  expect(afterSave({ ...base, dirty: true, force: true, bar: 'deleted', mtimeMs: null }, { conflict: false, mtimeMs: 300 })).toEqual({
    ...base,
    mtimeMs: 300,
  });
});

test('touches matches the file itself or a changed parent folder', () => {
  expect(touches(['src'], 'src/a.ts')).toBe(true);
  expect(touches(['src/a.ts'], 'src/a.ts')).toBe(true);
  expect(touches(['srcx/a.ts'], 'src/a.ts')).toBe(false);
  expect(touches(['src/a.tsx'], 'src/a.ts')).toBe(false);
  expect(touches(null, 'x')).toBe(true);
});

test('dirsToRefresh picks the expanded folders a change lands in', () => {
  expect(new Set(dirsToRefresh(['', 'src', 'lib'], ['src/a.ts', 'b.txt']))).toEqual(new Set(['src', '']));
  expect(new Set(dirsToRefresh(['', 'src'], ['src']))).toEqual(new Set(['', 'src']));
  expect(dirsToRefresh(['', 'src'], null)).toEqual(['', 'src']);
});
