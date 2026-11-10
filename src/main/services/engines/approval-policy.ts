import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { ApprovalRequest } from '@shared/permissions';
import { resolveInside } from '../files/guard';

// Project checks a developer may run without a card: npm check scripts (also in a subfolder with --prefix), and ruff
// and pytest. Python arguments are a fixed list of harmless flags plus relative paths, test ids and quoted expressions:
// no drive, absolute path, `..` or shell syntax. Flags that write, load code or move the root (--basetemp, -p, -c,
// --rootdir, -o, --output-file, --config, --cache-dir) are not on the list, so they get a card.
const NPM_CHECK = /^npm(?:\.cmd)? (?:--prefix \w[\w.-]* )?(?:test|run (?:typecheck|lint|test|build))$/;
const PYTEST_FLAG = String.raw`-qq?|-vv?|-[xsl]|--(?:lf|ff|sw|no-header)|-r[a-zA-Z]+|--tb=(?:auto|long|short|line|native|no)|--(?:maxfail|durations)=\d+|-[km]`;
const RUFF_FLAG = String.raw`--(?:fix|diff|statistics|show-fixes|quiet|no-cache|exit-zero)|-q|--(?:select|ignore)=[A-Za-z0-9,]+|--output-format=\w+`;
const PY_POSITIONAL = String.raw`(?:\.(?:\/[\w.\/-]*)?|\w[\w.\/-]*)(?:::[\w\[\].-]+)*|"[\w .-]*"`;
const pyArgs = (flags: string): string => `(?: (?:${flags}|${PY_POSITIONAL}))*`;
const RUNNER = String.raw`(?:(?:python3?|py|\.venv[\\/](?:Scripts|bin)[\\/]python(?:\.exe)?) -m )?`;
const PY_CHECK = new RegExp(`^${RUNNER}(?:pytest${pyArgs(PYTEST_FLAG)}|ruff (?:check|format --check)${pyArgs(RUFF_FLAG)})$`);

/**
 * A project check for the Auto policy, once the user allowed project code. Deliberately a superset of the Ask list
 * (workspace.checkCommands, the exact commands as typed): Auto also accepts flag and spelling variants of the same checks,
 * such as `pytest -x`, `npm.cmd test`, the worktree's .venv python or `npm --prefix <dir>` for any plain folder name.
 */
export const isProjectCheck = (command: unknown): boolean =>
  typeof command === 'string' && (NPM_CHECK.test(command) || (PY_CHECK.test(command) && !/(?:^|[\s=\/])\.\.(?:[\/\s]|$)/.test(command)));

/** Positive allowlist only. Unrecognized inputs and shell syntax always reach the user; a project check only once `projectCode` (the user's consent) is given. */
export function decideApproval(request: ApprovalRequest | undefined, root: string, projectCode: boolean): { allow: boolean; reason: string } {
  const ask = { allow: false, reason: 'Sensitive or unrecognized action' };
  if (!request || request.engine !== 'claude') return ask;
  const { input, tool, cwd } = request;
  if (input.dangerouslyDisableSandbox || input.grantRoot || input.additionalPermissions || input.arkShellStateUnknown) return ask;
  try {
    const actual = realpathSync(cwd);
    const base = realpathSync(root);
    if (process.platform === 'win32' ? actual.toLowerCase() !== base.toLowerCase() : actual !== base) return ask;
    if (tool === 'Bash' || tool === 'PowerShell') {
      const cmd = input.command;
      if (projectCode && isProjectCheck(cmd)) {
        return { allow: true, reason: 'Project check in the build worktree' };
      }
    } else if (tool === 'Edit' || tool === 'Write') {
      const file = input.file_path;
      if (typeof file !== 'string' || !isAbsolute(file)) return ask;
      const rel = relative(resolve(root), resolve(file)).replaceAll('\\', '/');
      // 8.3 short names (CLAUDE~1 is .claude) and NTFS streams (.env::$DATA) would hide a protected name.
      if (rel.split('/').some((p) => /~\d|:/.test(p))) return ask;
      resolveInside(root, rel);
      // Match on the canonical path too: an existing folder may be reached through another spelling.
      const parts = rel.split('/');
      let i = parts.length;
      while (i > 0 && !existsSync(join(base, ...parts.slice(0, i)))) i--;
      const canonical = [relative(base, realpathSync.native(join(base, ...parts.slice(0, i)))), ...parts.slice(i)].join('/').replaceAll('\\', '/');
      if (`${rel}/${canonical}`.split('/').some((p) => /^(?:\.git|\.claude|\.codex|\.env(?:\..*)?|credentials\.json|token\.json)$/i.test(p.replace(/[ .]+$/, '')))) return ask;
      return { allow: true, reason: 'File edit inside the build worktree' };
    }
  } catch {
    // Missing roots, links escaping the worktree and malformed paths require a card.
  }
  return ask;
}
