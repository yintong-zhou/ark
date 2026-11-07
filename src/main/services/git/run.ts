import { execFile } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import { NO_HOOKS } from '../threads/workspace';

/**
 * Every git call of the Git view. No project hooks (NO_HOOKS), no prompts, and pathspecs are literal, so a file called
 * `*.txt` or `:(top)x` is a plain name. Paths reach git on stdin or after `--`, never in option position.
 */

const MAX_BUFFER = 64 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const MAX_MESSAGE = 2000;

/** `env` adds to the environment of this one call. */
type Opts = { input?: string; timeoutMs?: number; env?: Record<string, string> };

function exec(dir: string, args: string[], opts: Opts, encoding: 'utf8' | 'buffer'): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['-c', `core.hooksPath=${NO_HOOKS}`, ...args],
      {
        cwd: dir,
        env: { ...process.env, GIT_LITERAL_PATHSPECS: '1', GIT_TERMINAL_PROMPT: '0', ...opts.env },
        windowsHide: true,
        encoding,
        maxBuffer: MAX_BUFFER,
        timeout: opts.timeoutMs ?? TIMEOUT_MS,
      },
      // Some failures only talk on stdout ("nothing to commit"), so it is the second choice, capped: it can be a whole listing.
      (err, stdout, stderr) =>
        err ? reject(new Error(String(stderr).trim() || String(stdout).trim().slice(0, MAX_MESSAGE) || `git ${args[0]} failed`)) : resolve(stdout),
    );
    child.stdin?.on('error', () => {}); // git can exit before it reads its input
    child.stdin?.end(opts.input); // always closed, so git never waits for more
  });
}

/** Git without the queue. Only for use inside `queued` (repo.ts's `inRepo`), where queueing again would wait for its own caller. */
export const gitNow = (dir: string, args: string[], opts: Opts = {}): Promise<string> =>
  exec(dir, args, opts, 'utf8') as Promise<string>;

export const gitNowBuffer = (dir: string, args: string[]): Promise<Buffer> => exec(dir, args, {}, 'buffer') as Promise<Buffer>;

const tails = new Map<string, Promise<unknown>>();

/** Runs `fn` after every earlier call on this folder has settled (a failure doesn't block the next). */
export function queued<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const key = resolvePath(dir).toLowerCase();
  const run = (tails.get(key) ?? Promise.resolve()).then(fn);
  const tail = run.catch(() => {});
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key); // keep the map from growing
  });
  return run;
}
