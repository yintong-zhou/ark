import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { agentId } from '@shared/agent-file';
import { obj } from '../json';

/** Git and project checks inside a thread's worktree. The project's own checked-out branch is never touched. */

export type CheckResult = { script: string; ok: boolean; tail: string };

export const CHECK_SCRIPTS = ['typecheck', 'lint', 'test', 'build'] as const;
const CHECK_MS = 600_000;
const CHECK_TAIL = 4_000;
const MAX_BUFFER = 64 * 1024 * 1024;

type Out = { ok: boolean; stdout: string; stderr: string };

/**
 * Ark's git runs no project hooks: they are code the agents can edit, and would run with no card. The path sits under
 * this process's executable, a file, so it can never be a folder (git then finds no hook). The user's own commits keep them.
 */
export const NO_HOOKS = join(process.execPath, 'no-hooks');

/** Runs git in `dir`; resolves with the output and never rejects. */
function git(dir: string, args: string[], timeoutMs = 60_000): Promise<Out> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', `core.hooksPath=${NO_HOOKS}`, '-C', dir, ...args],
      { windowsHide: true, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: timeoutMs },
      (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr }),
    );
  });
}

/** Like git(), but a failure throws git's stderr. */
async function gitOk(dir: string, args: string[]): Promise<string> {
  const r = await git(dir, args);
  if (!r.ok) throw new Error(r.stderr.trim() || `git ${args[0]} failed`);
  return r.stdout;
}

/** Why a script was killed, as a first line of its tail; both kills set `killed`, only the buffer one has this code. */
const why = (err: Error & { killed?: boolean; code?: unknown }, timeout: number) =>
  err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? `output over ${MAX_BUFFER / 1024 / 1024} MB, stopped\n`
  : err.killed ? `timed out after ${timeout / 1000} s\n` : '';

/** Runs one npm script. The shell is needed because npm is a .cmd on Windows; names come from CHECK_SCRIPTS only. */
function runScript(dir: string, script: string, timeout: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    execFile(
      `npm run ${script}`,
      [],
      { cwd: dir, shell: true, timeout, windowsHide: true, encoding: 'utf8', maxBuffer: MAX_BUFFER },
      (err, stdout, stderr) =>
        resolve({
          script,
          ok: !err,
          tail: err ? why(err, timeout) + `${stdout}${stderr}`.slice(-CHECK_TAIL) : '',
        }),
    );
  });
}

export const workspace = {
  /** HEAD sha, or undefined when there is no commit or `dir` is not a repo. */
  async head(dir: string): Promise<string | undefined> {
    const r = await git(dir, ['rev-parse', 'HEAD']);
    return r.ok ? r.stdout.trim() : undefined;
  },

  /** True when `dir` is the top folder of a Git working tree, not a folder inside one (git -C would walk up to it). */
  async isRepoRoot(dir: string): Promise<boolean> {
    const r = await git(dir, ['rev-parse', '--show-toplevel']);
    if (!r.ok) return false;
    try {
      const same = (p: string) => realpathSync.native(p).toLowerCase(); // Windows paths ignore case
      return same(r.stdout.trim()) === same(dir);
    } catch {
      return false;
    }
  },

  async addWorktree(repo: string, path: string, branch: string): Promise<void> {
    await gitOk(repo, ['worktree', 'add', '-b', branch, path, 'HEAD']);
  },

  /** Commits everything; the new sha, or undefined when there was nothing to commit. */
  async commitAll(dir: string, message: string): Promise<string | undefined> {
    await gitOk(dir, ['add', '-A']);
    if (!(await gitOk(dir, ['status', '--porcelain'])).trim()) return undefined;
    await gitOk(dir, ['commit', '-m', message]);
    return (await gitOk(dir, ['rev-parse', 'HEAD'])).trim();
  },

  diff: (dir: string, base: string) => gitOk(dir, ['diff', base, 'HEAD']),

  log: (dir: string, base: string) => gitOk(dir, ['log', '--oneline', `${base}..HEAD`]),

  /** The known check scripts the project defines; [] when package.json is missing or broken. */
  projectChecks(dir: string): string[] {
    try {
      const scripts = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts ?? {};
      return CHECK_SCRIPTS.filter((s) => typeof scripts[s] === 'string');
    } catch {
      return [];
    }
  },

  /** Runs every script in turn, even after a failure. */
  async runChecks(dir: string, scripts: string[], timeoutMs = CHECK_MS): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    for (const s of scripts) results.push(await runScript(dir, s, timeoutMs));
    return results;
  },
};

export type Workspace = typeof workspace;

/**
 * Why a build session must not start in `dir`: Claude Code loads its .claude/settings.json (--setting-sources project),
 * and allow rules, a default mode, extra directories, hooks or an API key helper there would act without an approval
 * card. Undefined when the file is
 * missing or sets none of them; a file that is not a JSON object fails closed.
 */
export function claudeSettingsProblem(dir: string): string | undefined {
  const file = join(dir, '.claude', 'settings.json');
  if (!existsSync(file)) return undefined;
  let s: Record<string, unknown> | undefined;
  try {
    s = obj(JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))); // editors on Windows write a BOM
  } catch {
    // unreadable or not JSON: s stays undefined
  }
  if (!s) return `${file} is not valid JSON, so Ark cannot tell whether it skips the approval cards. Fix or remove it, then try again.`;
  const set = (v: unknown) => v !== undefined && !(Array.isArray(v) ? !v.length : obj(v) && !Object.keys(v as object).length);
  const perms = obj(s.permissions);
  const keys = [
    set(perms?.allow) && 'permissions.allow',
    perms?.defaultMode !== undefined && 'permissions.defaultMode',
    set(perms?.additionalDirectories) && 'permissions.additionalDirectories',
    set(s.hooks) && 'hooks',
    set(s.apiKeyHelper) && 'apiKeyHelper',
  ].filter(Boolean);
  return keys.length ? `${file} sets ${keys.join(', ')}, which would act without an approval card. Remove them on the build branch, then try again.` : undefined;
}

/** Branch for a thread's worktree: readable title slug plus the thread id prefix for uniqueness. */
export function branchName(title: string, threadId: string): string {
  return `ark/${agentId(title).slice(0, 40).replace(/-+$/, '')}-${threadId.slice(0, 8)}`;
}
