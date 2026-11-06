import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Run an executable and capture stdout. Never throws: failures come back as ok=false. */
export function run(file: string, args: string[], timeoutMs = 5000): Promise<{ ok: boolean; stdout: string }> {
  // npm-installed CLIs are .cmd shims, which Windows can only start through a shell.
  const shell = /\.(cmd|bat)$/i.test(file);
  return new Promise((resolve) => {
    try {
      execFile(
        shell ? `"${file}"` : file,
        args,
        { timeout: timeoutMs, windowsHide: true, shell, encoding: 'utf8' },
        (err, stdout) => resolve({ ok: !err, stdout: String(stdout ?? '') }),
      );
    } catch {
      resolve({ ok: false, stdout: '' }); // execFile throws at once for a file Windows can't start (e.g. a bad .exe)
    }
  });
}

/**
 * First runnable match from `where.exe` output. npm installs an extensionless shell script next to
 * the .cmd shim and `where` lists it first, but Windows can't execute it.
 */
export function pickExecutable(lines: string[]): string | undefined {
  return lines.map((l) => l.trim()).find((l) => /\.(exe|cmd|bat)$/i.test(l));
}

/** Runnable path of a command on PATH, or undefined when it isn't installed. */
export async function which(cmd: string): Promise<string | undefined> {
  const r = await run('where.exe', [cmd]);
  return r.ok ? pickExecutable(r.stdout.split(/\r?\n/)) : undefined;
}

/** Git Bash, located the way Claude Code finds it: CLAUDE_CODE_GIT_BASH_PATH, else next to git.exe. */
export async function findGitBash(): Promise<string | undefined> {
  const configured = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  if (configured && existsSync(configured)) return configured;
  const git = await which('git');
  return git ? gitBashFromGit(git) : undefined;
}

/** Walk up from git.exe (<Git>\cmd or <Git>\mingw64\bin) to the folder that holds bin\bash.exe. */
export function gitBashFromGit(gitPath: string, exists: (p: string) => boolean = existsSync): string | undefined {
  let dir = dirname(gitPath);
  for (let i = 0; i < 3; i++) {
    dir = dirname(dir);
    const bash = join(dir, 'bin', 'bash.exe');
    if (exists(bash)) return bash;
  }
  return undefined;
}

export async function detect(cmd: string): Promise<{ installed: boolean; path?: string; version?: string }> {
  const path = await which(cmd);
  if (!path) return { installed: false };
  const r = await run(path, ['--version']);
  return { installed: true, path, version: r.stdout.match(/\d+\.\d+\.\d+/)?.[0] };
}
