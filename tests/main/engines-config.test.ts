import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { engineStatus, mergeEngines, readEngines, validateEngines, writeEngines } from '../../src/main/services/engines/config';

let root: string;
beforeEach(() => (root = mkdtempSync(join(tmpdir(), 'ark-engines-'))));
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('invalid file reads as {}', () => {
  expect(readEngines(root)).toEqual({}); // missing
  writeFileSync(join(root, 'engines.json'), '{not json');
  expect(readEngines(root)).toEqual({});
  writeFileSync(join(root, 'engines.json'), JSON.stringify({ claude: { path: 'relative.exe' } }));
  expect(readEngines(root)).toEqual({});
});

test('writes and reads back a valid config', () => {
  const c = { claude: { path: 'C:\\tools\\claude.exe' }, codex: { tiers: { light: 'my-model.1' } } };
  writeEngines(root, c);
  expect(readEngines(root)).toEqual(c);
});

test('saving a claude path keeps codex path and tiers', () => {
  const current = { codex: { path: 'C:\\tools\\codex.exe', tiers: { light: 'my-model.1' } } };
  expect(mergeEngines(current, { claude: { path: 'C:\\tools\\claude.exe' } })).toEqual({
    claude: { path: 'C:\\tools\\claude.exe' },
    codex: current.codex,
  });
});

test('saving a codex path keeps codex tiers and claude', () => {
  const current = { claude: { path: 'C:\\tools\\claude.exe' }, codex: { path: 'C:\\old\\codex.exe', tiers: { light: 'my-model.1' } } };
  expect(mergeEngines(current, { codex: { path: 'C:\\new\\codex.exe' } })).toEqual({
    claude: current.claude,
    codex: { path: 'C:\\new\\codex.exe', tiers: { light: 'my-model.1' } },
  });
});

test('rejects relative paths and bad tiers', () => {
  expect(() => validateEngines({ claude: { path: 'claude.exe' } })).toThrow();
  expect(() => validateEngines({ claude: { path: 'C:\\tools\\claude.txt' } })).toThrow();
  expect(() => validateEngines({ codex: { tiers: { huge: 'x' } } })).toThrow();
  expect(() => validateEngines({ codex: { tiers: { light: 'bad model!' } } })).toThrow();
  expect(() => validateEngines('nope')).toThrow();
  expect(() => writeEngines(root, { claude: { path: 'x.exe' } })).toThrow();
});

test('manual path wins over detection', async () => {
  mkdirSync(root, { recursive: true });
  const exe = join(root, 'claude.exe');
  writeFileSync(exe, 'not a real program');
  const detectFn = async (cmd: string) => ({ installed: true, path: `C:\\detected\\${cmd}.exe`, version: '9.9.9' });
  const s = await engineStatus({ claude: { path: exe } }, detectFn);
  expect(s.find((e) => e.id === 'claude')).toMatchObject({ installed: true, path: exe, manual: true });
  expect(s.find((e) => e.id === 'codex')).toEqual({
    id: 'codex',
    installed: true,
    path: 'C:\\detected\\codex.exe',
    version: '9.9.9',
    manual: false,
  });
});

test('a missing manual path falls back to detection', async () => {
  const detectFn = async () => ({ installed: false });
  const s = await engineStatus({ claude: { path: join(root, 'gone.exe') } }, detectFn);
  expect(s.find((e) => e.id === 'claude')).toEqual({ id: 'claude', installed: false, manual: false });
});
