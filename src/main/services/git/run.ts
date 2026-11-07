import { execFile } from 'node:child_process';
import { NO_HOOKS } from '../threads/workspace';

/**
 * Every git call of the Git view. No project hooks (NO_HOOKS), no prompts, and pathspecs are literal, so a file called
 * `*.txt` or `:(top)x` is a plain name. Paths reach git on stdin or after `--`, never in option position.
 */

const MAX_BUFFER = 64 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

type Opts = { input?: string; timeoutMs?: number };

function exec(dir: string, args: string[], opts: Opts, encoding: 'utf8' | 'buffer'): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['-c', `core.hooksPath=${NO_HOOKS}`, ...args],
      {
        cwd: dir,
        env: { ...process.env, GIT_LITERAL_PATHSPECS: '1', GIT_TERMINAL_PROMPT: '0' },
        windowsHide: true,
        encoding,
        maxBuffer: MAX_BUFFER,
        timeout: opts.timeoutMs ?? TIMEOUT_MS,
      },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr).trim() || `git ${args[0]} failed`)) : resolve(stdout)),
    );
    child.stdin?.on('error', () => {}); // git can exit before it reads its input
    child.stdin?.end(opts.input); // always closed, so git never waits for more
  });
}

/** Git without the queue. Only for use inside `queued`, where a gitRun would wait for its own caller. */
export const gitNow = (dir: string, args: string[], opts: Opts = {}): Promise<string> =>
  exec(dir, args, opts, 'utf8') as Promise<string>;

export const gitNowBuffer = (dir: string, args: string[]): Promise<Buffer> => exec(dir, args, {}, 'buffer') as Promise<Buffer>;

const tails = new Map<string, Promise<unknown>>();

/** Runs `fn` after every earlier call on this folder has settled (a failure doesn't block the next). */
export function queued<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const key = dir.toLowerCase();
  const run = (tails.get(key) ?? Promise.resolve()).then(fn);
  const tail = run.catch(() => {});
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key); // keep the map from growing
  });
  return run;
}

/** One git call, one place in the folder's queue. */
export const gitRun = (dir: string, args: string[], opts: Opts = {}): Promise<string> =>
  queued(dir, () => gitNow(dir, args, opts));

/** Like gitRun, stdout as bytes. */
export const gitBuffer = (dir: string, args: string[]): Promise<Buffer> => queued(dir, () => gitNowBuffer(dir, args));
