import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { ApprovalRequest } from '@shared/permissions';
import { resolveInside } from '../files/guard';

export const isProjectCheck = (command: unknown): boolean =>
  typeof command === 'string' && /^npm(?:\.cmd)? (?:test|run (?:typecheck|lint|test|build))$/.test(command);

/** Positive allowlist only. Unrecognized inputs and shell syntax always reach the user. */
export function decideApproval(request: ApprovalRequest | undefined, root: string): { allow: boolean; reason: string } {
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
      if (isProjectCheck(cmd)) {
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
