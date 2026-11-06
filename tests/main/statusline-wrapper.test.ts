import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const WRAPPER = join(__dirname, '../../resources/statusline-wrapper.cjs');
const payload = readFileSync(join(__dirname, '../fixtures/claude-statusline.json'), 'utf8');

/** A temp dir laid out like <userData>: the wrapper, its state file and a fake original status line. */
function setup(withOriginal = true, extra: { originalCommand?: (dir: string, orig: string) => string; shell?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ark-wrapper-'));
  copyFileSync(WRAPPER, join(dir, 'statusline-wrapper.cjs'));
  const orig = join(dir, 'orig.cjs').replace(/\\/g, '/');
  writeFileSync(orig, "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write('ORIG:'+s.length));");
  const originalCommand = !withOriginal ? null : extra.originalCommand ? extra.originalCommand(dir.replace(/\\/g, '/'), orig) : `node "${orig}"`;
  writeFileSync(join(dir, 'statusline-original.json'), JSON.stringify({ originalCommand, shell: extra.shell }));
  return dir;
}

const GIT_BASH = ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe'].find((p) => existsSync(p));

test.skipIf(!GIT_BASH)('runs the original through the shell recorded at Connect', () => {
  // `X=1 cmd` is bash-only syntax: under cmd.exe it fails and the user's status line would go blank.
  const dir = setup(true, { originalCommand: (_d, orig) => `X=1 node "${orig}"`, shell: GIT_BASH });
  const r = runWrapper(dir, payload);
  expect(r.stdout).toBe(`ORIG:${payload.length}`);
});

test('never runs itself', () => {
  const dir = setup(true, { originalCommand: (d) => `node "${d}/statusline-wrapper.cjs"` });
  const r = runWrapper(dir, payload);
  expect(r.status).toBe(0);
  expect(r.stdout.trim()).toBe('Opus 5.5 · ctx 46% · 5h 62% · wk 38%');
});

// No inherited SHELL: Claude Code doesn't guarantee one, and the test runner's own would hide bugs.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'SHELL'));
const runWrapper = (dir: string, input: string) =>
  spawnSync(process.execPath, [join(dir, 'statusline-wrapper.cjs')], { input, encoding: 'utf8', env, timeout: 20000 });

test('drops payload and passes original through', () => {
  const dir = setup();
  const r = runWrapper(dir, payload);
  expect(r.stdout.startsWith('ORIG:')).toBe(true);
  expect(readFileSync(join(dir, 'claude/sessions/abc-123.json'), 'utf8')).toBe(payload);
});

test('still runs original when drop fails', () => {
  const dir = setup();
  mkdirSync(join(dir, 'claude'));
  writeFileSync(join(dir, 'claude/sessions'), 'not a directory');
  const r = runWrapper(dir, payload);
  expect(r.status).toBe(0);
  expect(r.stdout.startsWith('ORIG:')).toBe(true);
});

test('rejects unsafe session id', () => {
  const dir = setup();
  const r = runWrapper(dir, JSON.stringify({ ...JSON.parse(payload), session_id: '../../x' }));
  expect(r.stdout.startsWith('ORIG:')).toBe(true);
  expect(readdirSync(dir, { recursive: true }).sort()).toEqual(
    ['orig.cjs', 'statusline-original.json', 'statusline-wrapper.cjs'],
  );
});

test('non-JSON stdin', () => {
  const dir = setup();
  const r = runWrapper(dir, 'not json {');
  expect(r.status).toBe(0);
  expect(r.stdout.startsWith('ORIG:')).toBe(true);
});

test('minimal line without original', () => {
  const dir = setup(false);
  const r = runWrapper(dir, payload);
  expect(r.stdout.trim()).toBe('Opus 5.5 · ctx 46% · 5h 62% · wk 38%');
});
