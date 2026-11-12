import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EMPTY_TEAMS, validateAgentTeams, type AgentTeams } from '@shared/agent-teams';
import { writeAtomic } from './files';

/** `agent-teams.json`: which user-made team each catalog agent belongs to. */
export class AgentTeamsStore {
  constructor(private readonly file: string) {}

  exists(): boolean {
    return existsSync(this.file);
  }

  /** A missing or corrupt file is an empty document. */
  read(): AgentTeams {
    try {
      return validateAgentTeams(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      return EMPTY_TEAMS;
    }
  }

  /** Validates, then writes atomically. Returns what was written. */
  write(t: unknown): AgentTeams {
    const clean = validateAgentTeams(t);
    mkdirSync(dirname(this.file), { recursive: true });
    writeAtomic(this.file, JSON.stringify(clean, null, 2));
    return clean;
  }
}
