import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ID_RE, agentId, parseAgentFile, serializeAgentFile, type AgentDef } from '@shared/agent-file';
import type { CatalogList, ImportableAgent } from '@shared/types';
import { writeAtomic } from './files';
import { IT_SERVICES_AGENTS } from './it-services';
import { pluginInstalls } from './skills';

const SAFE_ID = AGENT_ID_RE;
const mdFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return []; // a missing or unreadable folder is an empty one
  }
};

const TAIL = "Write in the language the user writes in. When you need the user's decision, ask one clear question.";
const seed = (
  id: string,
  name: string,
  description: string,
  engine: AgentDef['engine'],
  tier: AgentDef['tier'],
  skills: string[],
  permissions: AgentDef['permissions'],
  role: string,
): AgentDef => ({
  id, name, description, engine, tier, skills, permissions,
  prompt: `You are ${name}, a member of a small team working in Ark. ${role} ${TAIL}`,
});

/** First-run catalog: the Superpowers build cycle plus the IT Services specialists. */
export const SEED_AGENTS: AgentDef[] = [
  seed('project-manager', 'Project manager', 'Leads the thread, builds the team, and calls you when needed.',
    { kind: 'auto' }, 'light', ['superpowers:brainstorming'], 'read-only',
    "You lead the thread: you propose the team from the catalog with a one-line reason for each agent, decide who speaks next (one agent per turn), keep the discussion moving, and tag the user when a decision is theirs or when planning or reviews stall."),
  seed('planner', 'Planner', "Turns the team's decisions into a step-by-step plan.",
    { kind: 'auto' }, 'standard', ['superpowers:writing-plans'], 'read-only',
    "You turn what the team decided into a plan written as a Markdown file, split into phases, each with its goal and its checks. You do not write code."),
  seed('developer', 'Developer', 'Writes the code, following the plan.',
    { kind: 'model', engine: 'claude', model: 'opus' }, 'heavy',
    ['superpowers:test-driven-development', 'superpowers:executing-plans', 'superpowers:verification-before-completion'], 'build',
    "You implement the plan one phase at a time in the thread's worktree, run the project's checks, and do not finish a phase while they fail. You fix the findings the reviewers send back."),
  seed('code-reviewer', 'Code reviewer', "Reviews the developer's work.",
    { kind: 'engine', engine: 'codex' }, 'standard', ['agent-skills:code-review-and-quality'], 'read-only',
    "You review the diff of each phase for correctness, readability and fit with the plan, and send concrete findings back to the developer. You do not edit files."),
  seed('security-reviewer', 'Security reviewer', "Checks the developer's work for security issues.",
    { kind: 'engine', engine: 'codex' }, 'standard', ['agent-skills:security-and-hardening'], 'read-only',
    "You review the same diff for security problems such as injection, unsafe input handling, leaked secrets and risky permissions, and send concrete findings back to the developer. You do not edit files."),
  seed('marketing', 'Marketing', 'Writes product and launch copy.',
    { kind: 'auto' }, 'light', [], 'read-only',
    "You write product and launch copy: positioning, messages and announcements that match what the project really does."),
  seed('seo', 'SEO', "Improves how the project's pages rank in search.",
    { kind: 'auto' }, 'light', [], 'read-only',
    "You improve how the project's pages rank in search: titles, descriptions, headings, structure and keywords, without changing what the pages say."),
  ...IT_SERVICES_AGENTS,
];

/** The agent catalog: one `<id>.md` per agent under `dir`. */
export class Catalog {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error(`Unsafe agent id: ${id}`);
    return join(this.dir, `${id}.md`);
  }

  /** Every `<dir>/*.md`, sorted by name. Broken files go to `invalid` instead of failing the list. */
  list(): CatalogList {
    const agents: AgentDef[] = [];
    const invalid: CatalogList['invalid'] = [];
    for (const file of mdFiles(this.dir)) {
      const id = file.slice(0, -3);
      if (!SAFE_ID.test(id)) {
        invalid.push({ file, error: 'file name: use lowercase letters, digits, dashes and underscores (up to 64)' });
        continue;
      }
      try {
        const r = parseAgentFile(readFileSync(join(this.dir, file), 'utf8'), id);
        if (r.ok) agents.push(r.agent);
        else invalid.push({ file, error: r.error });
      } catch (e) {
        invalid.push({ file, error: e instanceof Error ? e.message : String(e) });
      }
    }
    agents.sort((a, b) => a.name.localeCompare(b.name));
    return { agents, invalid };
  }

  get(id: string): AgentDef | undefined {
    if (!SAFE_ID.test(id)) return undefined;
    try {
      const r = parseAgentFile(readFileSync(this.file(id), 'utf8'), id);
      return r.ok ? r.agent : undefined;
    } catch {
      return undefined;
    }
  }

  save(a: AgentDef): void {
    const file = this.file(a.id);
    mkdirSync(this.dir, { recursive: true });
    writeAtomic(file, serializeAgentFile(a));
  }

  remove(id: string): void {
    rmSync(this.file(id), { force: true });
  }

  /** Writes the seeds only when the folder has no agent file at all, so a deleted seed stays deleted. */
  seedIfEmpty(): void {
    if (mdFiles(this.dir).length === 0) for (const a of SEED_AGENTS) this.save(a);
  }

  /** Explicitly add the bundled team to an existing catalog, preserving even broken or customized files. */
  addItServices(): { added: string[]; skipped: string[] } {
    const added: string[] = [];
    const skipped: string[] = [];
    for (const a of IT_SERVICES_AGENTS) {
      if (existsSync(this.file(a.id))) skipped.push(a.id);
      else {
        this.save(a);
        added.push(a.id);
      }
    }
    return { added, skipped };
  }
}

/** Claude Code agents that can be imported: `<cfg>/agents/*.md` and each installed plugin's `agents/*.md`. */
export function importableAgents(claudeConfigDir: string): ImportableAgent[] {
  const out: ImportableAgent[] = [];
  const scan = (base: string, source: string) => {
    for (const f of mdFiles(base).sort()) out.push({ path: join(base, f), name: f.slice(0, -3), source });
  };
  scan(join(claudeConfigDir, 'agents'), 'Claude Code');
  for (const p of pluginInstalls(claudeConfigDir)) scan(join(p.installPath, 'agents'), p.plugin);
  return out;
}

/** Reads a Claude Code agent file (never modifies it) as a catalog agent. Throws on an invalid file. */
export function importAgent(path: string): AgentDef {
  const r = parseAgentFile(readFileSync(path, 'utf8'), 'imported'); // id is replaced below, once the name is known
  if (!r.ok) throw new Error(r.error);
  return { ...r.agent, id: agentId(r.agent.name) };
}
