import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  buildCommand,
  connectStatusline,
  disconnectStatusline,
  statuslineStatus,
  type StatuslinePaths,
} from '../../src/main/services/statusline';

const ORIGINAL = 'node C:/x/statusline.js';

function setup(settings?: unknown | string): StatuslinePaths {
  const root = mkdtempSync(join(tmpdir(), 'ark-sl-'));
  const claudeSettings = join(root, 'settings.json');
  if (settings !== undefined) {
    writeFileSync(claudeSettings, typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2));
  }
  const wrapperSource = join(root, 'wrapper-src.cjs');
  writeFileSync(wrapperSource, '// wrapper');
  return { claudeSettings, userData: join(root, 'userData'), wrapperSource, runner: { kind: 'node' } };
}

const readSettings = (p: StatuslinePaths) => JSON.parse(readFileSync(p.claudeSettings, 'utf8'));
const readState = (p: StatuslinePaths) =>
  JSON.parse(readFileSync(join(p.userData, 'statusline-original.json'), 'utf8'));

test('connect wraps existing command', () => {
  const p = setup({ statusLine: { type: 'command', command: ORIGINAL } });
  expect(statuslineStatus(p)).toBe('disconnected');
  expect(connectStatusline(p)).toBe('connected');
  expect(readState(p).originalCommand).toBe(ORIGINAL);
  expect(readSettings(p).statusLine.command).toBe(readState(p).ourCommand);
  expect(existsSync(join(p.userData, 'statusline-wrapper.cjs'))).toBe(true);
  expect(readdirSync(join(p.userData, 'backups'))).toHaveLength(1);
});

test('preserves other keys', () => {
  const others = { model: 'opus', hooks: { a: 1 }, permissions: { allow: ['x'] } };
  const p = setup({ ...others, statusLine: { type: 'command', command: ORIGINAL, padding: 0 } });
  connectStatusline(p);
  expect(readSettings(p)).toMatchObject(others);
  expect(readSettings(p).statusLine.padding).toBe(0);
  disconnectStatusline(p);
  expect(readSettings(p)).toEqual({ ...others, statusLine: { type: 'command', command: ORIGINAL, padding: 0 } });
});

test('disconnect restores original', () => {
  const p = setup({ statusLine: { type: 'command', command: ORIGINAL } });
  connectStatusline(p);
  expect(disconnectStatusline(p)).toBe('disconnected');
  expect(readSettings(p).statusLine.command).toBe(ORIGINAL);
  expect(existsSync(join(p.userData, 'statusline-original.json'))).toBe(false);
});

test('connect without existing statusLine', () => {
  const p = setup({ model: 'opus' });
  connectStatusline(p);
  expect(readState(p).originalCommand).toBeNull();
  disconnectStatusline(p);
  expect(readSettings(p)).toEqual({ model: 'opus' });
});

test('connect twice never wraps itself', () => {
  const p = setup({ statusLine: { type: 'command', command: ORIGINAL } });
  connectStatusline(p);
  expect(connectStatusline(p)).toBe('connected');
  expect(readState(p).originalCommand).toBe(ORIGINAL);
});

test('treats any Ark wrapper command as its own', () => {
  // e.g. userData was wiped, or node/Ark.exe moved: the command differs but it is still Ark's wrapper.
  const p = setup({ statusLine: { type: 'command', command: 'node "D:/old/userData/statusline-wrapper.cjs"' } });
  connectStatusline(p);
  expect(readState(p).originalCommand).toBeNull();
});

test('records the shell that runs the original', () => {
  const p = { ...setup({ statusLine: { type: 'command', command: ORIGINAL } }), shell: 'C:/Git/bin/bash.exe' };
  connectStatusline(p);
  expect(readState(p).shell).toBe('C:/Git/bin/bash.exe');
});

test('connect when settings.json does not exist', () => {
  const p = setup();
  expect(connectStatusline(p)).toBe('connected');
  expect(readState(p).originalCommand).toBeNull();
});

test('bypassed when user changed it', () => {
  const p = setup({ statusLine: { type: 'command', command: ORIGINAL } });
  connectStatusline(p);
  const s = readSettings(p);
  s.statusLine.command = 'node C:/mine/new.js';
  writeFileSync(p.claudeSettings, JSON.stringify(s));
  expect(statuslineStatus(p)).toBe('bypassed');
  expect(disconnectStatusline(p)).toBe('disconnected');
  expect(readSettings(p).statusLine.command).toBe('node C:/mine/new.js');
});

test('refuses invalid settings', () => {
  const p = setup('{ not json');
  expect(() => connectStatusline(p)).toThrow();
  expect(readFileSync(p.claudeSettings, 'utf8')).toBe('{ not json');
  expect(existsSync(join(p.userData, 'statusline-original.json'))).toBe(false);
});

test('buildCommand', () => {
  expect(buildCommand({ kind: 'electron', exe: 'C:\\A b\\Ark.exe' }, 'C:\\u\\w.cjs')).toBe(
    'ELECTRON_RUN_AS_NODE=1 "C:/A b/Ark.exe" "C:/u/w.cjs"',
  );
  expect(buildCommand({ kind: 'node' }, 'C:\\u\\w.cjs')).toBe('node "C:/u/w.cjs"');
});
