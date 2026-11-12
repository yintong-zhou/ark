import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ID_RE, agentId, parseAgentFile, serializeAgentFile, type AgentDef } from '@shared/agent-file';
import { assignFaces } from '@shared/avatars';
import type { CatalogList, ImportableAgent, TeamInfo } from '@shared/types';
import { writeAtomic } from './files';
import { READY_TEAMS, type ReadyTeam } from './teams';
import { pluginInstalls } from './skills';

const SAFE_ID = AGENT_ID_RE;
const mdFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return []; // a missing or unreadable folder is an empty one
  }
};

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
    return { agents: assignFaces(agents), invalid };
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

  private team(id: string): ReadyTeam {
    const found = READY_TEAMS.find((team) => team.id === id);
    if (!found) throw new Error('Unknown team');
    return found;
  }

  teams(): TeamInfo[] {
    return READY_TEAMS.map(({ id, name, description, agents }) => ({ id, name, description, count: agents.length, present: agents.filter((agent) => existsSync(this.file(agent.id))).length }));
  }

  addTeam(id: string): { added: string[]; skipped: string[] } {
    return this.addMissing(this.team(id).agents);
  }

  updateTeam(id: string): { updated: string[] } {
    const agents = this.team(id).agents;
    for (const agent of agents) this.save(agent);
    return { updated: agents.map((agent) => agent.id) };
  }

  private addMissing(agents: AgentDef[]): { added: string[]; skipped: string[] } {
    const added: string[] = [];
    const skipped: string[] = [];
    for (const a of agents) {
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
