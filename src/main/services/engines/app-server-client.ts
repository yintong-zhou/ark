import { obj, str } from '../json';
import { jsonLines, nodeSpawn, spawnCommand, type ChildLike, type SpawnFn } from './session';

const STDERR_TAIL = 500;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/**
 * JSON-RPC client for `codex app-server` (one JSON message per line over stdio).
 * Message shapes come from `codex app-server generate-ts` (Codex 0.165.0).
 */
export class AppServerClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private notifyCbs: ((method: string, params: unknown) => void)[] = [];
  private requestCbs: ((method: string, params: unknown, reply: (result: unknown) => void, id: string | number) => boolean)[] = [];
  private exitCbs: ((code: number | null, stderrTail: string) => void)[] = [];
  private stderr = '';
  private closed = false;

  private constructor(private child: ChildLike) {
    child.stderr.on('data', (d: Buffer | string) => (this.stderr = (this.stderr + d.toString()).slice(-STDERR_TAIL)));
    child.on('exit', (code) => {
      const tail = this.stderr.trim();
      this.fail(new Error(tail || `app-server exited (code ${code})`));
      if (!this.closed) this.exitCbs.forEach((cb) => cb(code, tail));
    });
    jsonLines(child.stdout, (msg) => this.onMessage(msg));
  }

  /**
   * Starts the process, then initialize + initialized. Kills the process if the handshake fails.
   * A Codex that starts right after another one was killed can fail to open its state database
   * (the dying process still holds it): that startup failure alone is retried, a few times.
   */
  static async open(
    exe: string,
    args: string[],
    o: { cwd: string; env: NodeJS.ProcessEnv; spawn?: SpawnFn; timeoutMs?: number; retryDelayMs?: number },
  ): Promise<AppServerClient> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await AppServerClient.openOnce(exe, args, o);
      } catch (e) {
        if (attempt >= 5 || !/state runtime/i.test((e as Error).message)) throw e;
        await new Promise((r) => setTimeout(r, o.retryDelayMs ?? 1000));
      }
    }
  }

  private static async openOnce(
    exe: string,
    args: string[],
    o: { cwd: string; env: NodeJS.ProcessEnv; spawn?: SpawnFn; timeoutMs?: number },
  ): Promise<AppServerClient> {
    const c = spawnCommand(exe, args); // .cmd/.bat shims need a shell and cmd.exe quoting
    const client = new AppServerClient((o.spawn ?? nodeSpawn)(c.command, c.args, { cwd: o.cwd, env: o.env, shell: c.shell }));
    try {
      await client.request('initialize', { clientInfo: { name: 'ark', title: 'Ark', version: '0.1.0' }, capabilities: null }, o.timeoutMs);
      client.send({ method: 'initialized' });
      return client;
    } catch (e) {
      client.close();
      throw e;
    }
  }

  /** Resolves with `result`; rejects on a JSON-RPC error, a timeout or when the process ends. */
  request(method: string, params: unknown, timeoutMs = 20000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('app-server closed'));
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  onNotification(cb: (method: string, params: unknown) => void): void {
    this.notifyCbs.push(cb);
  }

  /**
   * Server-initiated requests go to the callbacks in order; the first that returns true owns the request
   * and calls reply(result) later. Unclaimed requests get a JSON-RPC error (a denial). reply after close() does nothing.
   */
  onRequest(cb: (method: string, params: unknown, reply: (result: unknown) => void, id: string | number) => boolean): void {
    this.requestCbs.push(cb);
  }

  /** Called when the process ends by itself (not after close()). */
  onExit(cb: (code: number | null, stderrTail: string) => void): void {
    this.exitCbs.push(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.fail(new Error('app-server closed'));
    this.child.kill();
  }

  private send(m: unknown): void {
    this.child.stdin.write(JSON.stringify(m) + '\n');
  }

  private fail(e: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
  }

  private onMessage(msg: Record<string, unknown>): void {
    const method = str(msg.method);
    if (msg.id === undefined && method) return this.notifyCbs.forEach((cb) => cb(method, msg.params));
    if (method) {
      // A server-initiated request: a claiming callback answers later, otherwise answer now instead of leaving the server waiting.
      const id = msg.id;
      if (id === undefined) return;
      const reply = (result: unknown) => {
        if (!this.closed) this.send({ id, result });
      };
      if (!this.requestCbs.some((cb) => cb(method, msg.params, reply, id as string | number))) this.send({ id, error: { code: -32601, message: 'Method not supported by Ark' } });
      return;
    }
    if (typeof msg.id !== 'number') return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    const err = obj(msg.error);
    if (err || msg.error !== undefined) p.reject(new Error(str(err?.message) ?? 'JSON-RPC error'));
    else p.resolve(msg.result);
  }
}
