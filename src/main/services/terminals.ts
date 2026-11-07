import { randomUUID } from 'node:crypto';
import type { ShellOption } from '@shared/terminal';
import { findGitBash, which } from './exec';

/**
 * The user's terminals (spec §6.4). The PTYs live here; the renderer only gets ids, output and exit codes.
 * This is the user's shell, not an agent's: it gets the user's environment, not `cleanEnv`.
 */

export type Shell = ShellOption & { file: string; args: string[] };

/** The part of node-pty's IPty this service uses, so tests can pass a fake. */
export type Pty = {
  onData(cb: (d: string) => void): unknown;
  onExit(cb: (e: { exitCode: number }) => void): unknown;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};
export type Spawn = (file: string, args: string[], opts: { cwd: string; env: Record<string, string>; cols: number; rows: number; name: string }) => Pty;

/** PowerShell (pwsh when installed), Command Prompt, and Git Bash when it can be found. */
export async function listShells(find: { which: typeof which; gitBash: typeof findGitBash } = { which, gitBash: findGitBash }): Promise<Shell[]> {
  const [pwsh, bash] = await Promise.all([find.which('pwsh'), find.gitBash()]);
  const shells: Shell[] = [
    { id: 'powershell', name: 'PowerShell', file: pwsh ?? 'powershell.exe', args: ['-NoLogo'] },
    { id: 'cmd', name: 'Command Prompt', file: 'cmd.exe', args: [] },
  ];
  if (bash) shells.push({ id: 'gitbash', name: 'Git Bash', file: bash, args: ['--login', '-i'] });
  return shells;
}

/** The user's environment without Electron's own variables (ELECTRON_RUN_AS_NODE would break any Electron app run from it). */
export function shellEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !/^electron_/i.test(k)) out[k] = v;
  return out;
}

export function termSize(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 1000) throw new Error('Invalid size');
  return v;
}

export function termData(v: unknown): string {
  if (typeof v !== 'string' || v.length > 65_536) throw new Error('Invalid input');
  return v;
}

type Entry = { pty: Pty; buf: string; timer?: NodeJS.Timeout };

export class Terminals {
  private readonly terms = new Map<string, Entry>();

  constructor(
    private readonly spawn: Spawn,
    private readonly send: { data(id: string, chunk: string): void; exit(id: string, code: number): void },
    private readonly flushMs = 16,
  ) {}

  create(shell: Shell, cwd: string, cols: number, rows: number): string {
    const id = randomUUID();
    const pty = this.spawn(shell.file, shell.args, { cwd, env: shellEnv(process.env), cols, rows, name: 'xterm-256color' });
    const e: Entry = { pty, buf: '' };
    this.terms.set(id, e);
    // Output is batched, so a flood (`yes`, a big build log) is a few IPC messages, not thousands.
    pty.onData((d) => {
      if (this.terms.get(id) !== e) return;
      e.buf += d;
      e.timer ??= setTimeout(() => this.flush(id, e), this.flushMs);
    });
    pty.onExit(({ exitCode }) => {
      if (this.terms.get(id) !== e) return; // killed by us: the renderer already dropped it
      this.flush(id, e);
      this.terms.delete(id);
      this.send.exit(id, exitCode);
    });
    return id;
  }

  write(id: string, data: string): void {
    this.get(id).pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.get(id).pty.resize(cols, rows);
  }

  /** A no-op for an id it no longer holds: the shell may have exited while the user closed its tab. */
  kill(id: string): void {
    const e = this.terms.get(id);
    if (!e) return;
    this.drop(id, e);
  }

  killAll(): void {
    for (const [id, e] of [...this.terms]) this.drop(id, e);
  }

  private get(id: string): Entry {
    const e = this.terms.get(id);
    if (!e) throw new Error('Unknown terminal');
    return e;
  }

  private drop(id: string, e: Entry): void {
    clearTimeout(e.timer);
    this.terms.delete(id);
    try {
      e.pty.kill();
    } catch (err) {
      console.error('terminal kill failed', err); // already gone: nothing left to stop
    }
  }

  private flush(id: string, e: Entry): void {
    clearTimeout(e.timer);
    e.timer = undefined;
    if (!e.buf) return;
    const chunk = e.buf;
    e.buf = '';
    this.send.data(id, chunk);
  }
}
