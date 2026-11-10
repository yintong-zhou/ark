import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { agentId } from '@shared/agent-file';

/** Git and project checks inside a thread's worktree. The project's own checked-out branch is never touched. */

/** `skipped`: the check's tool is not installed (the command or Python module was not found), so it neither passed nor failed. */
export type CheckResult = { script: string; ok: boolean; tail: string; skipped?: true };

export const CHECK_SCRIPTS = ['typecheck', 'lint', 'test', 'build'] as const;
const CHECK_MS = 600_000;
const CHECK_TAIL = 4_000;
const MAX_BUFFER = 64 * 1024 * 1024;

// A check is named by the command a developer would type. Root npm scripts keep their bare names (typecheck, test...).
// Folder names go into a shell command, so only plain names qualify (no dot first: no .git, no ..).
const SAFE_DIR = /^\w[\w.-]*$/;
const SUB_CHECK = /^npm --prefix (\w[\w.-]*) run (typecheck|lint|test|build)$/;
const PY_CHECKS = ['ruff check .', 'python -m pytest -q'] as const;
const MAX_SUBDIRS = 8;

const read = (file: string) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};
function checkScripts(dir: string): string[] {
  try {
    const scripts = JSON.parse(read(join(dir, 'package.json'))).scripts ?? {};
    return CHECK_SCRIPTS.filter((s) => typeof scripts[s] === 'string');
  } catch {
    return [];
  }
}
/** Direct subfolders with their own npm check scripts, like a frontend in web/. */
function npmSubdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'node_modules' && SAFE_DIR.test(d.name) && checkScripts(join(dir, d.name)).length)
      .map((d) => d.name).sort().slice(0, MAX_SUBDIRS);
  } catch {
    return [];
  }
}
function pythonChecks(dir: string): string[] {
  const py = read(join(dir, 'pyproject.toml'));
  const out: string[] = [];
  if (/^\[tool\.ruff/m.test(py) || existsSync(join(dir, 'ruff.toml')) || existsSync(join(dir, '.ruff.toml'))) out.push(PY_CHECKS[0]);
  if (/^\[tool\.pytest/m.test(py) || existsSync(join(dir, 'pytest.ini')) || /^\[(tool:)?pytest\]/m.test(read(join(dir, 'setup.cfg'))) ||
      ((py || existsSync(join(dir, 'setup.py'))) && existsSync(join(dir, 'tests')))) out.push(PY_CHECKS[1]);
  return out;
}
const venvPython = (dir: string) => [join(dir, '.venv', 'Scripts', 'python.exe'), join(dir, '.venv', 'bin', 'python')].find((p) => existsSync(p));

/** True when `exe` is on PATH. The shell's own "not found" exit code and message depend on the platform and locale. */
function onPath(exe: string): boolean {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  return (process.env.PATH ?? '').split(delimiter).some((d) => d && exts.some((x) => existsSync(join(d, exe + x))));
}

/** The shell command for a check name; undefined for a name Ark does not know (never run). */
function commandOf(dir: string, script: string): string | undefined {
  if ((CHECK_SCRIPTS as readonly string[]).includes(script)) return `npm run ${script}`;
  if (SUB_CHECK.test(script)) return script;
  if (!(PY_CHECKS as readonly string[]).includes(script)) return undefined;
  const venv = venvPython(dir); // the worktree's own environment, when the developer made one
  return venv ? `"${venv}" -m ${script.replace(/^python -m /, '')}` : script;
}

/** What a fresh worktree lacks before its checks can run, as lines for the developer. */
export function setupHints(dir: string): string[] {
  const out: string[] = [];
  if (existsSync(join(dir, 'package.json')) && !existsSync(join(dir, 'node_modules'))) out.push('node_modules is missing: run npm ci first.');
  for (const sub of npmSubdirs(dir)) {
    if (!existsSync(join(dir, sub, 'node_modules'))) out.push(`${sub}/node_modules is missing: run npm --prefix ${sub} ci first.`);
  }
  if (pythonChecks(dir).length && !venvPython(dir)) {
    out.push("No Python environment in the worktree: create one with python -m venv .venv (it must be git-ignored) and install the project's dependencies into it. Ark runs the Python checks with it.");
  }
  return out;
}

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

/**
 * Runs one check. The shell is needed because npm is a .cmd on Windows; commands come from commandOf's fixed forms only.
 * The time and output limits are ours, not execFile's: execFile would kill only the shell, leaving npm and its children
 * running and holding the worktree. On Windows the whole tree goes, while the shell is still alive for taskkill to walk.
 * An abort of `signal` stops it the same way.
 */
function runScript(dir: string, script: string, timeout: number, signal?: AbortSignal): Promise<CheckResult> {
  const command = commandOf(dir, script);
  if (!command) return Promise.resolve({ script, ok: false, tail: 'Unknown check' });
  const tool = /^(ruff|python) /.exec(command)?.[1]; // a quoted venv python was found on disk already
  if (tool && !onPath(tool)) return Promise.resolve({ script, ok: true, tail: '', skipped: true });
  return new Promise((resolve) => {
    let stopped = '';
    const child = execFile(
      command,
      [],
      // execFile's own cap is only a backstop, above ours.
      { cwd: dir, shell: true, windowsHide: true, encoding: 'utf8', maxBuffer: 2 * MAX_BUFFER },
      (err, stdout, stderr) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        const out = `${stdout}${stderr}`;
        // Not installed, for ruff and pytest only (npm's 127 means missing node_modules, a real failure): sh's 127,
        // the Windows Store python stub, or Python without the check's module.
        const code = (err as { code?: unknown } | null)?.code;
        if (!stopped && tool && (code === 127 || /Python was not found|No module named '?(?:pytest|ruff)\b/.test(out))) {
          return resolve({ script, ok: true, tail: '', skipped: true });
        }
        // A script we stopped fails even if it got to exit 0 before the kill landed.
        const ok = !err && !stopped;
        resolve({ script, ok, tail: ok ? '' : stopped + out.slice(-CHECK_TAIL) });
      },
    );
    const stop = (why: string) => {
      if (stopped) return;
      stopped = why;
      if (process.platform === 'win32' && child.pid)
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      else child.kill();
    };
    const timer = setTimeout(() => stop(`timed out after ${timeout / 1000} s\n`), timeout);
    const abort = () => stop('stopped\n');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let size = 0;
    const count = (chunk: string) => {
      size += chunk.length;
      if (size > MAX_BUFFER) stop(`output over ${MAX_BUFFER / 1024 / 1024} MB, stopped\n`);
    };
    child.stdout?.on('data', count);
    child.stderr?.on('data', count);
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

  /**
   * The checks the project defines, in order: root npm check scripts (bare names), the same scripts in direct subfolders
   * (`npm --prefix web run test`), then ruff and pytest when the Python project configures them.
   */
  projectChecks(dir: string): string[] {
    return [
      ...checkScripts(dir),
      ...npmSubdirs(dir).flatMap((sub) => checkScripts(join(dir, sub)).map((s) => `npm --prefix ${sub} run ${s}`)),
      ...pythonChecks(dir),
    ];
  },

  /**
   * projectChecks as a developer types them: root names become `npm run <s>` (and test also `npm test`); subfolder and
   * Python checks stay as they are. The one list the Claude developer may run without a card in Ask once project code is
   * allowed; Auto's isProjectCheck accepts a superset (flag and spelling variants of these).
   */
  checkCommands(dir: string): string[] {
    return workspace.projectChecks(dir).flatMap((s) =>
      (CHECK_SCRIPTS as readonly string[]).includes(s) ? [`npm run ${s}`, ...(s === 'test' ? ['npm test'] : [])] : [s]);
  },

  /** Runs every script in turn, even after a failure. An abort of `signal` stops the running one and skips the rest. */
  async runChecks(dir: string, scripts: string[], timeoutMs = CHECK_MS, signal?: AbortSignal): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    for (const s of scripts) {
      if (signal?.aborted) break;
      results.push(await runScript(dir, s, timeoutMs, signal));
    }
    return results;
  },
};

export type Workspace = typeof workspace;

/** Branch for a thread's worktree: readable title slug plus the thread id prefix for uniqueness. */
export function branchName(title: string, threadId: string): string {
  return `ark/${agentId(title).slice(0, 40).replace(/-+$/, '')}-${threadId.slice(0, 8)}`;
}
