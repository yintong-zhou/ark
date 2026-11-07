import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { RootWatcher } from '../../src/main/services/files/watch';

let dir: string;
let w: RootWatcher;
let calls: [string, string[] | null][];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ark-watch-'));
  mkdirSync(join(dir, 'sub'));
  mkdirSync(join(dir, '.git'));
  calls = [];
  w = new RootWatcher((key, rels) => calls.push([key, rels]));
});
afterEach(() => {
  w.closeAll();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const quiet = (ms: number) => new Promise((r) => setTimeout(r, ms));
const seen = () => new Set(calls.flatMap(([, rels]) => rels ?? []));

test('changes close together arrive in one batch, with / separators', async () => {
  w.watch('k', dir);
  await quiet(50);
  writeFileSync(join(dir, 'a.txt'), '1');
  writeFileSync(join(dir, 'sub', 'b.txt'), '2');
  await vi.waitFor(() => expect([...seen()]).toEqual(expect.arrayContaining(['a.txt', 'sub/b.txt'])), { timeout: 2000 });
  expect(calls.every(([k]) => k === 'k')).toBe(true);
  expect(calls.length).toBeLessThanOrEqual(2); // one batch, or two if the OS split them across the window
});

test('changes inside .git are dropped', async () => {
  w.watch('k', dir);
  await quiet(50);
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref');
  await quiet(500);
  expect([...seen()].filter((r) => r === '.git' || r.startsWith('.git/'))).toEqual([]);
});

test('watching is reference counted', async () => {
  w.watch('k', dir);
  w.watch('k', dir);
  w.unwatch('k');
  await quiet(50);
  writeFileSync(join(dir, 'a.txt'), '1');
  await vi.waitFor(() => expect(seen().has('a.txt')).toBe(true), { timeout: 2000 });
  w.unwatch('k');
  await quiet(300);
  calls = [];
  writeFileSync(join(dir, 'c.txt'), '1');
  await quiet(500);
  expect(calls).toEqual([]);
});

test('closeAll stops every watcher', async () => {
  w.watch('k', dir);
  w.closeAll();
  writeFileSync(join(dir, 'a.txt'), '1');
  await quiet(500);
  expect(calls).toEqual([]);
});
