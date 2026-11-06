import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { nodeSpawn, spawnCommand, type ChildLike } from '../../src/main/services/engines/session';

let root: string;
let child: ChildLike | undefined;
let grandchild = 0;
beforeEach(() => (root = mkdtempSync(join(tmpdir(), 'ark-kill-'))));
afterEach(() => {
  // Best effort, so a failed step never leaves the looping node process behind.
  child?.kill(); // kills the cmd.exe wrapper and its tree while it is still running
  child = undefined;
  try {
    if (grandchild) process.kill(grandchild);
  } catch {
    // already gone
  }
  grandchild = 0;
  rmSync(root, { recursive: true, force: true });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// A throwaway .cmd that starts a long-running node grandchild (no real engine involved).
test('kill() on a .cmd engine also ends the process behind the cmd.exe wrapper', async () => {
  const pidFile = join(root, 'pid.txt');
  const script = join(root, 'child.js');
  writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`);
  const cmd = join(root, 'engine.cmd');
  writeFileSync(cmd, `@echo off\r\n"${process.execPath}" "${script}"\r\n`);
  const c = spawnCommand(cmd, []);
  child = nodeSpawn(c.command, c.args, { cwd: root, env: process.env, shell: c.shell });
  const exited = new Promise<void>((r) => child?.on('exit', () => r()));
  await expect.poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '', { timeout: 10_000 }).toBe(true);
  const pid = (grandchild = Number(readFileSync(pidFile, 'utf8')));
  expect(alive(pid)).toBe(true);
  child.kill();
  await exited;
  await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false);
});
