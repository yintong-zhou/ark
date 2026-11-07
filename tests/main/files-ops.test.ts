import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createEntry, listDir, readText, renameEntry, statFile, trashEntry, writeText } from '../../src/main/services/files/ops';

let dir: string;
let outside: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ark-ops-'));
  outside = mkdtempSync(join(tmpdir(), 'ark-out-'));
  writeFileSync(join(outside, 'x'), 'secret');
  symlinkSync(outside, join(dir, 'out'), 'junction');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const put = (rel: string, data: string | Uint8Array) => writeFileSync(join(dir, rel), data);

test('listDir puts folders first, sorts case-insensitively, hides .git, marks links', () => {
  mkdirSync(join(dir, 'B'));
  mkdirSync(join(dir, 'a'));
  mkdirSync(join(dir, '.git'));
  put('c.txt', '');
  put('D.txt', '');
  const l = listDir(dir, '');
  expect(l.entries).toEqual([
    { name: 'a', kind: 'dir' },
    { name: 'B', kind: 'dir' },
    { name: 'c.txt', kind: 'file' },
    { name: 'D.txt', kind: 'file' },
    { name: 'out', kind: 'link' },
  ]);
  expect(l.truncated).toBe(false);
});

test('listDir caps a huge folder at 5000 entries', () => {
  mkdirSync(join(dir, 'big'));
  for (let i = 0; i < 5001; i++) writeFileSync(join(dir, 'big', `f${i}`), '');
  const l = listDir(dir, 'big');
  expect(l.entries).toHaveLength(5000);
  expect(l.truncated).toBe(true);
});

test('readText reads UTF-8 text with its mtime', () => {
  put('a.txt', 'héllo');
  expect(readText(dir, 'a.txt')).toEqual({ kind: 'text', text: 'héllo', mtimeMs: statSync(join(dir, 'a.txt')).mtimeMs, bom: false, readonly: false });
});

test('readText strips and reports a BOM', () => {
  put('b.txt', Buffer.from([0xef, 0xbb, 0xbf, 0x61]));
  expect(readText(dir, 'b.txt')).toMatchObject({ kind: 'text', text: 'a', bom: true });
});

test('readText reports binary and too-large files', () => {
  put('bin', Buffer.from([0x61, 0x00, 0x62]));
  expect(readText(dir, 'bin')).toEqual({ kind: 'binary' });
  put('large', Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
  expect(readText(dir, 'large')).toEqual({ kind: 'large', size: 5242881 });
});

test('readText opens invalid UTF-8 read-only', () => {
  put('bad', Buffer.from([0xc3, 0x28]));
  const r = readText(dir, 'bad');
  expect(r).toMatchObject({ kind: 'text', readonly: true });
  expect(r.kind === 'text' && r.text).toContain('�');
});

test('statFile gives the mtime of a file, null for a folder or a missing path', () => {
  put('a.txt', 'x');
  mkdirSync(join(dir, 'sub'));
  expect(statFile(dir, 'a.txt')).toEqual({ mtimeMs: statSync(join(dir, 'a.txt')).mtimeMs });
  expect(statFile(dir, 'sub')).toBeNull();
  expect(statFile(dir, 'nope')).toBeNull();
});

test('writeText writes when the base matches and returns the new mtime', () => {
  put('a.txt', 'old');
  const base = statSync(join(dir, 'a.txt')).mtimeMs;
  const r = writeText(dir, 'a.txt', 'new', base, false);
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('new');
  expect(r).toEqual({ conflict: false, mtimeMs: statFile(dir, 'a.txt')?.mtimeMs });
});

test('writeText refuses a stale base and leaves the file alone', () => {
  put('a.txt', 'agent');
  const base = statSync(join(dir, 'a.txt')).mtimeMs;
  utimesSync(join(dir, 'a.txt'), new Date(), new Date(Date.now() + 5000));
  expect(writeText(dir, 'a.txt', 'mine', base, false)).toEqual({ conflict: true });
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('agent');
});

test('writeText overwrites with a null base and keeps a BOM', () => {
  put('a.txt', 'agent');
  writeText(dir, 'a.txt', 'mine', null, true);
  expect([...readFileSync(join(dir, 'a.txt'))]).toEqual([0xef, 0xbb, 0xbf, ...Buffer.from('mine')]);
});

test('writeText recreates a missing file with a null base, and calls a number base a conflict', () => {
  expect(writeText(dir, 'gone/a.txt', 'x', 123, false)).toEqual({ conflict: true });
  expect(writeText(dir, 'gone/a.txt', 'x', null, false).conflict).toBe(false);
  expect(readFileSync(join(dir, 'gone', 'a.txt'), 'utf8')).toBe('x');
});

test('createEntry makes an empty file or a folder, and refuses an existing path', () => {
  createEntry(dir, 'n.txt', 'file');
  createEntry(dir, 'nd', 'dir');
  expect(readFileSync(join(dir, 'n.txt'), 'utf8')).toBe('');
  expect(statSync(join(dir, 'nd')).isDirectory()).toBe(true);
  expect(() => createEntry(dir, 'n.txt', 'file')).toThrow('Already exists');
  expect(() => createEntry(dir, 'nd', 'dir')).toThrow('Already exists');
});

test('renameEntry moves and refuses an existing target', () => {
  put('a.txt', 'x');
  put('b.txt', 'y');
  expect(() => renameEntry(dir, 'a.txt', 'b.txt')).toThrow('Already exists');
  renameEntry(dir, 'a.txt', 'c.txt');
  expect(existsSync(join(dir, 'a.txt'))).toBe(false);
  expect(readFileSync(join(dir, 'c.txt'), 'utf8')).toBe('x');
});

test('trashEntry hands the absolute path to the trash', async () => {
  put('a.txt', 'x');
  const trash = vi.fn(async () => {});
  await trashEntry(dir, 'a.txt', trash);
  expect(trash).toHaveBeenCalledWith(join(dir, 'a.txt'));
});

test('a save never follows a planted <file>.tmp link out of the folder, and leaves a real .tmp alone', () => {
  put('a.ts', 'old');
  put('b.ts', 'old');
  put('b.ts.tmp', 'my own notes');
  let linked = true;
  try {
    symlinkSync(join(outside, 'x'), join(dir, 'a.ts.tmp'), 'file');
  } catch {
    linked = false; // file symlinks need Developer Mode on Windows; the .tmp half still runs
  }
  if (linked) {
    writeText(dir, 'a.ts', 'PWNED', null, false);
    expect(readFileSync(join(outside, 'x'), 'utf8')).toBe('secret');
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('PWNED');
  }
  writeText(dir, 'b.ts', 'new', null, false);
  expect(readFileSync(join(dir, 'b.ts.tmp'), 'utf8')).toBe('my own notes');
  expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toBe('new');
});

test('every operation refuses a path through a junction that leaves the folder', async () => {
  expect(() => listDir(dir, 'out')).toThrow('outside');
  expect(() => readText(dir, 'out/x')).toThrow('outside');
  expect(() => statFile(dir, 'out/x')).toThrow('outside');
  expect(() => writeText(dir, 'out/x', 'y', null, false)).toThrow('outside');
  expect(() => createEntry(dir, 'out/y', 'file')).toThrow('outside');
  expect(() => renameEntry(dir, 'out/x', 'x')).toThrow('outside');
  await expect(trashEntry(dir, 'out/x', async () => {})).rejects.toThrow('outside');
  expect(readFileSync(join(outside, 'x'), 'utf8')).toBe('secret');
});
