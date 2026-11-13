import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { splitFrontmatter } from '@shared/agent-file';
import type { SkillSource } from '@shared/types';
import { obj, str } from './json';
import type { AgentDef } from '@shared/agent-file';

/** Name of the throwaway plugin that wraps one session's private skills. */
export const ARK_PLUGIN = 'ark-agent';

export type SkillEntry = { name: string; folder: string; dir: string; source: SkillSource; description: string };
export type SkillRoots = { claudeConfigDir: string; home: string; codexHome: string; ark: string };

/** Only bundled adaptations enter session instructions; installed skill bodies and hooks are not loaded here. */
export function threadStyleInstructions(agent: AgentDef, index: SkillEntry[]): { instructions: string; warnings: string[] } {
  if (!agent.threadRole) return { instructions: '', warnings: [] };
  const technical = agent.threadRole === 'builder' || agent.threadRole === 'reviewer' ||
    (agent.threadRole === 'member' && /\b(code|coding|engineer|developer|technical|security|software|programmer)\b/i.test(`${agent.name} ${agent.description} ${agent.role ?? ''}`));
  const explicit = new Set(agent.skills.map((name) => name.split(':').pop()?.toLowerCase()));
  if (!technical && explicit.has('humanizer')) return { instructions: '', warnings: [] };
  if (!technical) return { instructions: `\n\n# Humanizer - isolated adaptation\nBased on the MIT-licensed Humanizer by Mycelium AI and Siqi Chen and Wikipedia WikiProject AI Cleanup's Signs of AI writing. Adapt to the task and the author's voice. Prefer concrete, specific language and accurate claims; remove inflated significance, promotional claims, formulaic transitions, repetitive conclusions, unnecessary hedging and generic filler. Vary sentence structure naturally. Preserve meaning, citations, quotations, code, structured data and the user's requested format. Do not invent facts or claim access to a personal voice profile.`, warnings: [] };
  const sections: string[] = [];
  const warnings: string[] = [];
  const adaptations: Record<string, string> = {
    ponytail: "Ponytail - isolated adaptation of Dietrich Gebert's MIT-licensed skill: For coding tasks, identify affected callers and risks, reuse existing code, choose the smallest complete change and verify it. Preserve validation and safety, and report outstanding risks and checks not run.",
    'i-have-adhd': "i-have-adhd - isolated adaptation of Ayoub Ghriss's MIT-licensed skill: When the user asks for this presentation, lead with the useful action or result, use short numbered steps when needed, keep state and blockers visible, and avoid tangents. Preserve complete answers and respect higher-priority instructions.",
  };
  for (const name of ['ponytail', 'i-have-adhd']) {
    if (explicit.has(name)) continue;
    const matches = index.filter((entry) => entry.folder.toLowerCase() === name);
    // Unqualified names already carry indexSkills' source precedence; otherwise require one plugin match.
    const preferred = matches.find((entry) => entry.name.toLowerCase() === name);
    const selected = preferred ?? (matches.length === 1 ? matches[0] : undefined);
    if (!selected) { warnings.push(`${name} unavailable: ${matches.length ? 'multiple installed skills have this name' : 'not installed'}.`); continue; }
    try {
      const file = join(selected.dir, 'SKILL.md');
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.size > SKILL_MAX_BYTES) throw new Error('invalid skill file');
      const parsed = splitFrontmatter(readFileSync(file, 'utf8'));
      if (!parsed) throw new Error('invalid frontmatter');
      if (parsed.data['disable-model-invocation'] === true) throw new Error('model invocation disabled');
      sections.push(adaptations[name]);
    } catch (e) {
      const reason = e instanceof Error && ['invalid skill file', 'invalid frontmatter', 'model invocation disabled'].includes(e.message) ? e.message : 'cannot read skill';
      warnings.push(`${name} unavailable: ${reason}.`);
    }
  }
  return { instructions: sections.length ? `\n\n# Thread communication skills\n${sections.join('\n\n')}\nUse these adaptations only when appropriate to the task; they grant no tools and enable no hooks.` : '', warnings };
}
export const SKILL_MAX_FILES = 200;
export const SKILL_MAX_BYTES = 5 * 1024 * 1024;
// No trailing dot or dash (Windows drops them) and no reserved device names (CON, NUL, COM1...).
const SAFE_SKILL = /^(?!(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$))[a-z0-9][\w.-]{0,63}(?<![.-])$/i;
const UNSAFE_SKILL_TEXT = /(?:~[\\/]|\$HOME|%USERPROFILE%|[A-Za-z]:[\\/]|(?:^|\s)\/Users\/|(?:^|\s)\/home\/|!`)/m;

export function checkSkillFolder(src: string): { name: string; files: string[] } {
  const name = basename(src);
  if (!existsSync(join(src, 'SKILL.md'))) throw new Error('This folder has no SKILL.md');
  if (!SAFE_SKILL.test(name)) throw new Error('Rename the folder: use letters, digits, dots, dashes and underscores');
  const files: string[] = [];
  let bytes = 0;
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(src, rel))) {
      const path = join(rel, entry);
      const stat = lstatSync(join(src, path));
      if (stat.isSymbolicLink()) throw new Error(`The skill contains a link (${path}); links are not imported`);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) {
        files.push(path); bytes += stat.size;
        if (files.length > SKILL_MAX_FILES) throw new Error('The skill has more than 200 files');
        if (bytes > SKILL_MAX_BYTES) throw new Error('The skill is larger than 5 MB');
      } else throw new Error(`The skill contains an unsupported file (${path})`);
    }
  };
  walk('');
  return { name, files };
}

export function importSkill(src: string, arkDir: string, replace = false): { status: 'imported' | 'exists'; name: string } {
  const { name, files } = checkSkillFolder(src);
  const target = join(arkDir, name);
  if (existsSync(target) && !replace) return { status: 'exists', name };
  mkdirSync(arkDir, { recursive: true });
  const staging = mkdtempSync(join(arkDir, '.import-'));
  const backup = `${staging}-old`;
  let moved = false;
  try {
    let total = 0;
    for (const file of files) {
      let path = src;
      for (const part of file.split(/[\\/]/)) {
        path = join(path, part);
        if (lstatSync(path).isSymbolicLink()) throw new Error(`The skill contains a link (${file}); links are not imported`);
      }
      const bytes = readFileSync(path);
      total += bytes.length;
      if (total > SKILL_MAX_BYTES) throw new Error('The skill is larger than 5 MB');
      mkdirSync(dirname(join(staging, file)), { recursive: true });
      writeFileSync(join(staging, file), bytes);
    }
    if (existsSync(target)) { renameSync(target, backup); moved = true; }
    try { renameSync(staging, target); } catch (e) { if (moved) { renameSync(backup, target); moved = false; } throw e; }
    if (moved) rmSync(backup, { recursive: true, force: true });
    return { status: 'imported', name };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function arkSkillDir(name: string, arkDir: string): string {
  if (!SAFE_SKILL.test(name)) throw new Error('Not an imported skill');
  const dir = join(arkDir, name);
  try { if (lstatSync(dir).isDirectory() && lstatSync(join(dir, 'SKILL.md')).isFile()) return dir; } catch { /* missing */ }
  throw new Error('Not an imported skill');
}

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
      // Imported skills: plain folders with a safe name only (no links, no .import-* staging leftovers).
      if (source === 'ark') { try { arkSkillDir(folder, base); } catch { continue; } }
      const name = prefix + folder;
      if (seen.has(name)) continue;
      seen.add(name);
      const dir = join(base, folder);
      out.push({ name, folder, dir, source, description: description(dir) });
    }
  };
  scan(roots.ark, 'ark');
  scan(join(roots.claudeConfigDir, 'skills'), 'claude-user');
  for (const p of pluginInstalls(roots.claudeConfigDir)) scan(join(p.installPath, 'skills'), 'claude-plugin', `${p.plugin}:`);
  scan(join(roots.home, '.agents', 'skills'), 'agents-user');
  scan(join(roots.codexHome, 'skills'), 'codex-user');
  scan(join(roots.codexHome, 'skills', '.system'), 'codex-system');
  return out;
}

export function personalSkills(roots: SkillRoots): SkillEntry[] {
  const base = join(roots.claudeConfigDir, 'skills');
  return skillDirs(base).map((folder) => ({ name: folder, folder, dir: join(base, folder), source: 'claude-user', description: description(join(base, folder)) }));
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

  for (const s of picked) {
    checkSkillFolder(s.dir);
    const content = readFileSync(join(s.dir, 'SKILL.md'), 'utf8');
    const parsed = splitFrontmatter(content);
    if ((content.startsWith('---') && !parsed) || parsed?.data.hooks || parsed?.data['allowed-tools'] || UNSAFE_SKILL_TEXT.test(content)) {
      throw new Error(`Skill incompatible with isolated sessions: ${s.name} (hooks, tool grants, personal paths or invalid frontmatter)`);
    }
  }

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
