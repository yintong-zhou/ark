import { execFile, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import type { ImageInput } from '@shared/attachments';
import type { ChatEvent } from '@shared/types';

/** One running chat with an engine. Events arrive through onEvent; send() starts a turn. */
export interface EngineSession {
  readonly busy: boolean;
  send(text: string, images?: ImageInput[]): void;
  stop(): void;
  /** Answers an approval event. Throws 'This request is no longer pending' for an unknown or already answered id. */
  answer(id: string, allow: boolean): void;
  onEvent(cb: (e: ChatEvent) => void): void;
}

/** The slice of a child process the sessions use (so tests can fake it). */
export type ChildLike = {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(): void;
  on(ev: 'exit', cb: (code: number | null) => void): void;
};

export type SpawnFn = (command: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; shell: boolean }) => ChildLike;

/**
 * child_process.spawn with piped stdio. A spawn failure (bad path) or a write to a dead child
 * must never crash the main process: the failure is reported as an exit with code null and the
 * error message on stderr. 'close' (not 'exit') is used so stdout/stderr are fully read first.
 */
export const nodeSpawn: SpawnFn = (command, args, o) => {
  const child = spawn(command, args, { cwd: o.cwd, env: o.env, shell: o.shell, stdio: 'pipe', windowsHide: true });
  const cbs: ((code: number | null) => void)[] = [];
  let done = false;
  const finish = (code: number | null) => {
    if (done) return;
    done = true;
    cbs.forEach((cb) => cb(code));
  };
  const stderr = new PassThrough(); // child.stderr plus any spawn error text
  child.stderr.pipe(stderr, { end: false });
  child.stdin.on('error', () => {});
  child.on('error', (e) => {
    stderr.write(e.message);
    finish(null);
  });
  child.on('close', (code) => finish(code));
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr,
    kill: () => {
      // A shell wrapper (.cmd shim) hides the real engine one level down: kill the whole tree.
      if (child.exitCode !== null || child.signalCode !== null) return; // gone already: its pid may be reused
      if (o.shell && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      else child.kill();
    },
    on: (_ev, cb) => void cbs.push(cb),
  };
};

const NEEDS_QUOTES = /[\s"&|<>^]/;
const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"';

/** `.cmd`/`.bat` shims only run through a shell, so they get cmd.exe quoting; everything else runs directly. */
export function spawnCommand(file: string, args: string[]): { command: string; args: string[]; shell: boolean } {
  if (!/\.(cmd|bat)$/i.test(file)) return { command: file, args, shell: false };
  return { command: quote(file), args: args.map((a) => (NEEDS_QUOTES.test(a) ? quote(a) : a)), shell: true };
}

/** Calls cb for every line of the stream that parses as a JSON object; other lines are skipped. */
export function jsonLines(stream: Readable, cb: (o: Record<string, unknown>) => void): void {
  const decoder = new StringDecoder('utf8');
  let buf = '';
  const line = (l: string) => {
    try {
      const v: unknown = JSON.parse(l);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) cb(v as Record<string, unknown>);
    } catch {
      /* not JSON (banner, warning): skip */
    }
  };
  stream.on('data', (chunk: Buffer | string) => {
    buf += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    parts.forEach(line);
  });
  stream.on('end', () => {
    buf += decoder.end();
    if (buf.trim()) line(buf);
    buf = '';
  });
}
