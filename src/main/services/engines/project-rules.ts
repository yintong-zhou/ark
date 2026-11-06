import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const MAX_DEPTH = 3;
const IMPORT = /^@(\S+)\s*$/;

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * The project's CLAUDE.md as instructions for Codex, with its `@file` import lines inlined.
 * Codex reads AGENTS.md itself, so when that exists there is nothing to add. Imports that resolve
 * outside the project (including through links) stay as plain text; nesting stops at depth 3.
 */
export function codexProjectRules(projectDir: string): string | undefined {
  if (existsSync(join(projectDir, 'AGENTS.md'))) return undefined;
  const claude = join(projectDir, 'CLAUDE.md');
  if (!isFile(claude)) return undefined;
  const root = realpathSync(projectDir);
  const inside = (p: string): boolean => {
    const rel = relative(root, p);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  };
  const expand = (file: string, depth: number): string => {
    const text = readFileSync(file, 'utf8');
    if (depth >= MAX_DEPTH) return text.trimEnd();
    return text
      .split(/\r?\n/)
      .map((line) => {
        const m = IMPORT.exec(line);
        if (!m) return line;
        const target = resolve(dirname(file), m[1]);
        if (!isFile(target)) return line;
        const real = realpathSync(target);
        return inside(real) ? expand(real, depth + 1) : line;
      })
      .join('\n')
      .trimEnd();
  };
  return expand(realpathSync(claude), 0);
}
