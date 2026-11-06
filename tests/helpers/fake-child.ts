import { PassThrough } from 'node:stream';
import type { ChildLike } from '../../src/main/services/engines/session';

/** A scripted child process: tests push lines into stdout and read what the session wrote to stdin. */
export class FakeChild implements ChildLike {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  private exitCbs: ((code: number | null) => void)[] = [];
  private input = '';

  constructor() {
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (d: string) => (this.input += d));
  }

  kill(): void {
    this.killed = true;
  }

  on(_ev: 'exit', cb: (code: number | null) => void): void {
    this.exitCbs.push(cb);
  }

  /** Lines the session has written to stdin so far. */
  written(): string[] {
    return this.input.split('\n').filter(Boolean);
  }

  emitLine(o: unknown): void {
    this.stdout.write(JSON.stringify(o) + '\n');
  }

  /** Writes stderr, then reports the exit on a later tick (like a real child: streams drain first). */
  exit(code: number | null, stderr = ''): void {
    if (stderr) this.stderr.write(stderr);
    setImmediate(() => this.exitCbs.forEach((cb) => cb(code)));
  }
}
