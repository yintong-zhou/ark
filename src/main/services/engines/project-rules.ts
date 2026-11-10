import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
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

/** True when `p` lies strictly inside `root` (both already real paths). */
const isInside = (root: string, p: string): boolean => {
  const rel = relative(root, p);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
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
        return isInside(root, real) ? expand(real, depth + 1) : line;
      })
      .join('\n')
      .trimEnd();
  };
  const top = realpathSync(claude);
  if (!isInside(root, top)) return undefined; // a CLAUDE.md that is a link to a file outside the project
  return expand(top, 0);
}

const IMPORT_DEPTH = 4; // Claude Code follows at most four hops of @imports
const IMPORT_TOKEN = /(?:^|\s)@((?:\\ |\S)+)/g;

/** The text where Claude Code looks for @imports: fenced blocks and code spans are skipped. */
const importable = (text: string): string => {
  let fenced = false;
  return text
    .split(/\r?\n/)
    .filter((l) => (/^\s*(```|~~~)/.test(l) ? ((fenced = !fenced), false) : !fenced))
    .join('\n')
    .replace(/`[^`\n]*`/g, ' ');
};

/**
 * Why a Claude session must not start in `projectDir`: its CLAUDE.md, CLAUDE.local.md or .claude/CLAUDE.md (or a file
 * they import) has an `@import` of an existing file outside the project. Claude Code accepts absolute and ~ paths there
 * and loads them if the user ever approved external imports for the folder, so the agent could be handed files such as
 * ~/.ssh keys (docs: code.claude.com/docs/en/memory, "Import additional files"; not verified live). Same containment as
 * codexProjectRules, links included. Undefined when clean; imports of files that do not exist are ignored.
 */
export function claudeImportProblem(projectDir: string): string | undefined {
  let root: string;
  try {
    root = realpathSync(projectDir);
  } catch {
    return undefined;
  }
  const seen = new Set<string>();
  const scan = (file: string, depth: number): string | undefined => {
    const real = realpathSync(file);
    if (seen.has(real)) return undefined;
    seen.add(real);
    for (const m of importable(readFileSync(real, 'utf8')).matchAll(IMPORT_TOKEN)) {
      const token = m[1].replaceAll('\\ ', ' ');
      const target = token === '~' || /^~[\\/]/.test(token) ? join(homedir(), token.slice(1)) : resolve(dirname(file), token);
      if (!isFile(target)) continue;
      const found = realpathSync(target);
      if (!isInside(root, found)) {
        return `${file} imports @${token}, which is outside the project, so Claude Code would load it into the agent. Remove the import, then try again.`;
      }
      const nested = depth < IMPORT_DEPTH ? scan(found, depth + 1) : undefined;
      if (nested) return nested;
    }
    return undefined;
  };
  for (const f of [join(projectDir, 'CLAUDE.md'), join(projectDir, 'CLAUDE.local.md'), join(projectDir, '.claude', 'CLAUDE.md')]) {
    const p = isFile(f) ? scan(f, 1) : undefined;
    if (p) return p;
  }
  return undefined;
}
