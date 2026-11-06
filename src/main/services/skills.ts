import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitFrontmatter } from '@shared/agent-file';
import type { SkillSource } from '@shared/types';
import { obj, str } from './json';

/** Name of the throwaway plugin that wraps one session's private skills. */
export const ARK_PLUGIN = 'ark-agent';

export type SkillEntry = { name: string; folder: string; dir: string; source: SkillSource; description: string };
export type SkillRoots = { claudeConfigDir: string; home: string; codexHome: string };

/** Subfolders of `dir` that hold a SKILL.md. Unreadable or missing dirs give []. */
function skillDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && existsSync(join(dir, e.name, 'SKILL.md')))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function description(dir: string): string {
  try {
    const d = splitFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'))?.data.description;
    return typeof d === 'string' ? d.trim() : '';
  } catch {
    return '';
  }
}

/** Install path of each plugin: the user-scope install, otherwise the last one listed. */
export function pluginInstalls(claudeConfigDir: string): { plugin: string; installPath: string }[] {
  let plugins: Record<string, unknown> | undefined;
  try {
    plugins = obj(obj(JSON.parse(readFileSync(join(claudeConfigDir, 'plugins', 'installed_plugins.json'), 'utf8')))?.plugins);
  } catch {
    return [];
  }
  const out: { plugin: string; installPath: string }[] = [];
  for (const [key, list] of Object.entries(plugins ?? {})) {
    const installs = (Array.isArray(list) ? list : []).map(obj).filter((i) => i !== undefined);
    const pick = installs.find((i) => i.scope === 'user') ?? installs[installs.length - 1];
    const installPath = str(pick?.installPath);
    if (installPath) out.push({ plugin: key.split('@')[0], installPath });
  }
  return out;
}

/** Every installed skill, in source order. For a repeated name the first one wins. */
export function indexSkills(roots: SkillRoots): SkillEntry[] {
  const seen = new Set<string>();
  const out: SkillEntry[] = [];
  const scan = (base: string, source: SkillSource, prefix = '') => {
    for (const folder of skillDirs(base)) {
      if (source === 'codex-user' && folder.startsWith('.')) continue;
      const name = prefix + folder;
      if (seen.has(name)) continue;
      seen.add(name);
      const dir = join(base, folder);
      out.push({ name, folder, dir, source, description: description(dir) });
    }
  };
  scan(join(roots.claudeConfigDir, 'skills'), 'claude-user');
  for (const p of pluginInstalls(roots.claudeConfigDir)) scan(join(p.installPath, 'skills'), 'claude-plugin', `${p.plugin}:`);
  scan(join(roots.home, '.agents', 'skills'), 'agents-user');
  scan(join(roots.codexHome, 'skills'), 'codex-user');
  scan(join(roots.codexHome, 'skills', '.system'), 'codex-system');
  return out;
}

/**
 * Copies the named skills into `target`, the only skill folder an engine sees. Reads the source
 * skill dirs and writes under `target` only. `folders` are the copied folder names, `missing`
 * the names that are not installed.
 */
export function buildSkillFolder(
  layout: 'claude-plugin' | 'codex-root',
  target: string,
  names: string[],
  index: SkillEntry[],
): { missing: string[]; folders: string[] } {
  const missing: string[] = [];
  const picked: SkillEntry[] = [];
  for (const n of names) {
    const s = index.find((e) => e.name === n);
    if (s) picked.push(s);
    else missing.push(n);
  }
  const folders = picked.map((s) => s.folder);
  const dup = folders.find((f, i) => folders.indexOf(f) !== i);
  if (dup) throw new Error(`Two skills named ${dup}`);

  const base = layout === 'claude-plugin' ? join(target, 'skills') : target;
  mkdirSync(base, { recursive: true });
  if (layout === 'claude-plugin') {
    mkdirSync(join(target, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(target, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: ARK_PLUGIN, version: '0.0.0', description: 'Ark private skills for one agent session' }),
    );
  }
  for (const s of picked) cpSync(s.dir, join(base, s.folder), { recursive: true, dereference: true }); // real copies, never links back into the user's folders
  return { missing, folders };
}
