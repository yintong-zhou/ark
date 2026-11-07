import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { UUID_RE } from '@shared/files';
import { listShells, shellEnv, termData, termSize, Terminals, type Pty, type Shell, type Spawn } from '../../src/main/services/terminals';

/** A pty that records what the service does to it and lets the test play the shell. */
class FakePty implements Pty {
  writes: string[] = [];
  sizes: [number, number][] = [];
  killed = 0;
  failKill = false;
  private data: ((d: string) => void)[] = [];
  private exits: ((e: { exitCode: number }) => void)[] = [];
  onData = (cb: (d: string) => void) => this.data.push(cb);
  onExit = (cb: (e: { exitCode: number }) => void) => this.exits.push(cb);
  write = (d: string) => void this.writes.push(d);
  resize = (c: number, r: number) => void this.sizes.push([c, r]);
  kill = () => {
    this.killed++;
    if (this.failKill) throw new Error('already gone');
  };
  emitData = (d: string) => this.data.forEach((cb) => cb(d));
  emitExit = (exitCode: number) => this.exits.forEach((cb) => cb({ exitCode }));
}

const PS: Shell = { id: 'powershell', name: 'PowerShell', file: 'powershell.exe', args: ['-NoLogo'] };
let ptys: FakePty[];
let spawn: ReturnType<typeof vi.fn<Spawn>>;
let sent: [string, string, string | number][];
let t: Terminals;

beforeEach(() => {
  vi.useFakeTimers();
  ptys = [];
  spawn = vi.fn<Spawn>(() => (ptys.push(new FakePty()), ptys.at(-1) as FakePty));
  sent = [];
  t = new Terminals(spawn, { data: (id, c) => sent.push(['data', id, c]), exit: (id, code) => sent.push(['exit', id, code]) });
});
afterEach(() => vi.useRealTimers());

test('create spawns the shell in cwd with the clean env and returns a uuid', () => {
  const id = t.create(PS, 'C:\\p', 80, 24);
  expect(id).toMatch(UUID_RE);
  expect(spawn).toHaveBeenCalledWith('powershell.exe', ['-NoLogo'], { cwd: 'C:\\p', cols: 80, rows: 24, name: 'xterm-256color', env: shellEnv(process.env) });
});

test('write and resize reach the pty', () => {
  const id = t.create(PS, 'C:\\p', 80, 24);
  t.write(id, 'dir\r');
  t.resize(id, 100, 30);
  expect(ptys[0].writes).toEqual(['dir\r']);
  expect(ptys[0].sizes).toEqual([[100, 30]]);
});

test('chunks within 16 ms are sent once, and pending data is flushed before exit', () => {
  const id = t.create(PS, 'C:\\p', 80, 24);
  const pty = ptys[0];
  pty.emitData('a');
  pty.emitData('b');
  expect(sent).toEqual([]);
  vi.advanceTimersByTime(16);
  expect(sent).toEqual([['data', id, 'ab']]);
  pty.emitData('c');
  pty.emitExit(3);
  expect(sent.slice(1)).toEqual([['data', id, 'c'], ['exit', id, 3]]);
  vi.runAllTimers();
  expect(sent).toHaveLength(3);
});

test('write and resize on an unknown id throw Unknown terminal', () => {
  const id = t.create(PS, 'C:\\p', 80, 24);
  ptys[0].emitExit(0);
  expect(() => t.write(id, 'x')).toThrow('Unknown terminal');
  expect(() => t.resize(id, 10, 10)).toThrow('Unknown terminal');
  expect(() => t.write('00000000-0000-0000-0000-000000000000', 'x')).toThrow('Unknown terminal');
});

// The shell can exit while the user clicks ×: kill must not turn that race into an error.
test('kill after exit is a no-op', () => {
  const id = t.create(PS, 'C:\\p', 80, 24);
  ptys[0].emitExit(0);
  expect(() => t.kill(id)).not.toThrow();
  expect(ptys[0].killed).toBe(0);
});

test('kill sends no exit for the id', () => {
  const id = t.create(PS, 'C:\\p', 80, 24);
  ptys[0].emitData('late');
  t.kill(id);
  ptys[0].emitExit(1);
  vi.runAllTimers();
  expect(ptys[0].killed).toBe(1);
  expect(sent).toEqual([]);
});

test('killAll kills every pty and sends nothing', () => {
  t.create(PS, 'C:\\p', 80, 24);
  t.create(PS, 'C:\\q', 80, 24);
  ptys[0].failKill = true;
  ptys[1].emitData('x');
  expect(() => t.killAll()).not.toThrow();
  expect(ptys.map((p) => p.killed)).toEqual([1, 1]);
  ptys.forEach((p) => p.emitExit(0));
  vi.runAllTimers();
  expect(sent).toEqual([]);
});

test('shellEnv drops ELECTRON_* in any case and keeps the rest', () => {
  expect(shellEnv({ PATH: 'x', ELECTRON_RUN_AS_NODE: '1', electron_no_attach_console: '1', Foo: undefined })).toEqual({ PATH: 'x' });
});

test('listShells prefers pwsh and lists Git Bash only when found', async () => {
  const shells = await listShells({ which: async (c) => (c === 'pwsh' ? 'C:\\pwsh\\pwsh.exe' : undefined), gitBash: async () => undefined });
  expect(shells.map((s) => [s.id, s.file, s.args])).toEqual([
    ['powershell', 'C:\\pwsh\\pwsh.exe', ['-NoLogo']],
    ['cmd', 'cmd.exe', []],
  ]);
  const shells2 = await listShells({ which: async () => undefined, gitBash: async () => 'C:\\Git\\bin\\bash.exe' });
  expect(shells2.map((s) => s.file)).toEqual(['powershell.exe', 'cmd.exe', 'C:\\Git\\bin\\bash.exe']);
  expect(shells2.map((s) => s.name)).toEqual(['PowerShell', 'Command Prompt', 'Git Bash']);
  expect(shells2[2].args).toEqual(['--login', '-i']);
});

test('termSize accepts integers 1..1000 only', () => {
  expect(termSize(1)).toBe(1);
  expect(termSize(1000)).toBe(1000);
  for (const bad of [0, 1001, 1.5, '80', NaN]) expect(() => termSize(bad)).toThrow('Invalid size');
});

test('termData accepts strings up to 65 536 characters', () => {
  expect(termData('x'.repeat(65536))).toHaveLength(65536);
  for (const bad of ['x'.repeat(65537), 1, null]) expect(() => termData(bad)).toThrow('Invalid input');
});

test.runIf(process.platform === 'win32')('node-pty runs cmd.exe /c echo', async () => {
  vi.useRealTimers();
  const { spawn: realSpawn } = await import('node-pty');
  const pty = realSpawn('cmd.exe', ['/c', 'echo ark-pty-ok'], { cwd: tmpdir(), cols: 80, rows: 24, name: 'xterm-256color', env: shellEnv(process.env) });
  let out = '';
  pty.onData((d) => (out += d));
  const code = await new Promise<number>((resolve) => pty.onExit((e) => resolve(e.exitCode)));
  expect(out).toContain('ark-pty-ok');
  expect(code).toBe(0);
}, 10_000);
